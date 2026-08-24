#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <node_api.h>

#include <string>
#include <vector>

namespace {

class ScopedCfType {
 public:
  explicit ScopedCfType(CFTypeRef value = nullptr) : value_(value) {}
  ~ScopedCfType() {
    if (value_ != nullptr) {
      CFRelease(value_);
    }
  }
  ScopedCfType(const ScopedCfType&) = delete;
  ScopedCfType& operator=(const ScopedCfType&) = delete;
  CFTypeRef get() const { return value_; }

 private:
  CFTypeRef value_;
};

std::string ReadUtf8(napi_env env, napi_value value) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) {
    napi_throw_type_error(env, nullptr, "Expected a UTF-8 string.");
    return {};
  }
  std::vector<char> buffer(length + 1);
  if (napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(),
                                 &length) != napi_ok) {
    napi_throw_type_error(env, nullptr, "Expected a UTF-8 string.");
    return {};
  }
  return std::string(buffer.data(), length);
}

CFStringRef CreateCfString(const std::string& value) {
  return CFStringCreateWithBytes(
      kCFAllocatorDefault,
      reinterpret_cast<const UInt8*>(value.data()),
      static_cast<CFIndex>(value.size()), kCFStringEncodingUTF8, false);
}

CFMutableDictionaryRef CreateQuery(const std::string& service,
                                   const std::string& account) {
  auto* query = CFDictionaryCreateMutable(
      kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks,
      &kCFTypeDictionaryValueCallBacks);
  if (query == nullptr) {
    return nullptr;
  }

  ScopedCfType service_value(CreateCfString(service));
  ScopedCfType account_value(CreateCfString(account));
  if (service_value.get() == nullptr || account_value.get() == nullptr) {
    CFRelease(query);
    return nullptr;
  }

  CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
  CFDictionarySetValue(query, kSecAttrService, service_value.get());
  CFDictionarySetValue(query, kSecAttrAccount, account_value.get());
  return query;
}

void ThrowStatus(napi_env env, const char* operation, OSStatus status) {
  ScopedCfType message(SecCopyErrorMessageString(status, nullptr));
  std::string detail = "macOS secure storage returned OSStatus " +
                       std::to_string(static_cast<long long>(status));
  if (message.get() != nullptr) {
    char buffer[1024] = {};
    if (CFStringGetCString(static_cast<CFStringRef>(message.get()), buffer,
                           sizeof(buffer), kCFStringEncodingUTF8)) {
      detail += ": ";
      detail += buffer;
    }
  }
  const std::string text = std::string(operation) + " failed: " + detail;
  napi_throw_error(env, nullptr, text.c_str());
}

bool ReadArguments(napi_env env, napi_callback_info info, size_t expected,
                   std::vector<std::string>* values) {
  size_t argc = expected;
  std::vector<napi_value> argv(expected);
  if (napi_get_cb_info(env, info, &argc, argv.data(), nullptr, nullptr) !=
          napi_ok ||
      argc != expected) {
    napi_throw_type_error(env, nullptr, "Invalid secure storage arguments.");
    return false;
  }
  values->reserve(expected);
  for (const auto value : argv) {
    napi_valuetype type = napi_undefined;
    if (napi_typeof(env, value, &type) != napi_ok || type != napi_string) {
      napi_throw_type_error(env, nullptr,
                            "Secure storage arguments must be strings.");
      return false;
    }
    values->push_back(ReadUtf8(env, value));
    bool exception_pending = false;
    if (napi_is_exception_pending(env, &exception_pending) != napi_ok ||
        exception_pending) {
      return false;
    }
  }
  return true;
}

napi_value Store(napi_env env, napi_callback_info info) {
  std::vector<std::string> args;
  if (!ReadArguments(env, info, 3, &args)) {
    return nullptr;
  }
  ScopedCfType query(CreateQuery(args[0], args[1]));
  if (query.get() == nullptr) {
    napi_throw_error(env, nullptr, "Could not create a secure storage query.");
    return nullptr;
  }
  const auto& token = args[2];
  ScopedCfType token_data(CFDataCreate(
      kCFAllocatorDefault, reinterpret_cast<const UInt8*>(token.data()),
      static_cast<CFIndex>(token.size())));
  if (token_data.get() == nullptr) {
    napi_throw_error(env, nullptr, "Could not encode the access token.");
    return nullptr;
  }

  auto* update = CFDictionaryCreateMutable(
      kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks,
      &kCFTypeDictionaryValueCallBacks);
  if (update == nullptr) {
    napi_throw_error(env, nullptr, "Could not create a secure storage update.");
    return nullptr;
  }
  ScopedCfType scoped_update(update);
  CFDictionarySetValue(update, kSecValueData, token_data.get());
  OSStatus status =
      SecItemUpdate(static_cast<CFDictionaryRef>(query.get()), update);
  if (status == errSecItemNotFound) {
    auto* addition = CFDictionaryCreateMutableCopy(
        kCFAllocatorDefault, 0,
        static_cast<CFDictionaryRef>(query.get()));
    if (addition == nullptr) {
      napi_throw_error(env, nullptr,
                       "Could not create a secure storage item.");
      return nullptr;
    }
    ScopedCfType scoped_addition(addition);
    CFDictionarySetValue(addition, kSecValueData, token_data.get());
    CFDictionarySetValue(addition, kSecAttrAccessible,
                         kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly);
    status = SecItemAdd(addition, nullptr);
  }
  if (status != errSecSuccess) {
    ThrowStatus(env, "Store access token", status);
    return nullptr;
  }

  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

napi_value Read(napi_env env, napi_callback_info info) {
  std::vector<std::string> args;
  if (!ReadArguments(env, info, 2, &args)) {
    return nullptr;
  }
  ScopedCfType query(CreateQuery(args[0], args[1]));
  if (query.get() == nullptr) {
    napi_throw_error(env, nullptr, "Could not create a secure storage query.");
    return nullptr;
  }
  auto* mutable_query =
      static_cast<CFMutableDictionaryRef>(const_cast<void*>(query.get()));
  CFDictionarySetValue(mutable_query, kSecReturnData, kCFBooleanTrue);
  CFDictionarySetValue(mutable_query, kSecMatchLimit, kSecMatchLimitOne);

  CFTypeRef result = nullptr;
  const OSStatus status = SecItemCopyMatching(
      static_cast<CFDictionaryRef>(query.get()), &result);
  ScopedCfType scoped_result(result);
  if (status == errSecItemNotFound) {
    napi_value null_value;
    napi_get_null(env, &null_value);
    return null_value;
  }
  if (status != errSecSuccess || result == nullptr ||
      CFGetTypeID(result) != CFDataGetTypeID()) {
    ThrowStatus(env, "Read access token",
                status == errSecSuccess ? errSecDecode : status);
    return nullptr;
  }

  const auto* data = static_cast<CFDataRef>(result);
  napi_value token;
  napi_create_string_utf8(
      env, reinterpret_cast<const char*>(CFDataGetBytePtr(data)),
      static_cast<size_t>(CFDataGetLength(data)), &token);
  return token;
}

napi_value Remove(napi_env env, napi_callback_info info) {
  std::vector<std::string> args;
  if (!ReadArguments(env, info, 2, &args)) {
    return nullptr;
  }
  ScopedCfType query(CreateQuery(args[0], args[1]));
  if (query.get() == nullptr) {
    napi_throw_error(env, nullptr, "Could not create a secure storage query.");
    return nullptr;
  }
  const OSStatus status =
      SecItemDelete(static_cast<CFDictionaryRef>(query.get()));
  if (status != errSecSuccess && status != errSecItemNotFound) {
    ThrowStatus(env, "Delete access token", status);
    return nullptr;
  }
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

napi_value Initialize(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"store", nullptr, Store, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"read", nullptr, Read, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"remove", nullptr, Remove, nullptr, nullptr, nullptr, napi_default,
       nullptr},
  };
  napi_define_properties(env, exports,
                         sizeof(properties) / sizeof(properties[0]),
                         properties);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Initialize)
