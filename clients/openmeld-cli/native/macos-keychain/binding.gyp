{
  "targets": [
    {
      "target_name": "openmeld_keychain",
      "sources": ["src/openmeld_keychain.mm"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "CLANG_ENABLE_OBJC_ARC": "YES",
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "MACOSX_DEPLOYMENT_TARGET": "12.0",
              "OTHER_LDFLAGS": [
                "-Wl,-S",
                "-framework CoreFoundation",
                "-framework LocalAuthentication",
                "-framework Security"
              ]
            }
          }
        ]
      ]
    }
  ]
}
