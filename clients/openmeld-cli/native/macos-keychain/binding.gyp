{
  "targets": [
    {
      "target_name": "openmeld_keychain",
      "sources": ["openmeld_keychain.cc"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "MACOSX_DEPLOYMENT_TARGET": "12.0",
              "OTHER_LDFLAGS": [
                "-framework CoreFoundation",
                "-framework Security"
              ]
            }
          }
        ]
      ]
    }
  ]
}
