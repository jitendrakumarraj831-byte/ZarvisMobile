# Starter R8/ProGuard rules — see MASTER_SPEC.md §32 and app/build.gradle.kts' `release`
# build type comment: isMinifyEnabled is currently false because this environment has no way
# to compile-verify a minified build. These rules are a scaffold for whoever flips it on,
# not a substitute for a real build + smoke test afterward.
#
# Most dependencies here (Retrofit, OkHttp, Room, Hilt, kotlinx.coroutines) ship their own
# consumer-rules.pro bundled in their AARs, which AGP merges automatically — they do not need
# rules repeated here. The entries below cover the two classes of failure R8 causes that
# those consumer rules can't: reflection-based (de)serialization, and this app's own DTOs.

# kotlinx.serialization: keep generated serializers and the @Serializable model classes they
# reflect over (data/data-remote/dto/Dtos.kt) — R8's default obfuscation renames/removes the
# fields serialization relies on discovering by name.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.zarvismobile.**$$serializer { *; }
-keepclassmembers class com.zarvismobile.** {
    *** Companion;
}
-keepclasseswithmembers class com.zarvismobile.** {
    kotlinx.serialization.KSerializer serializer(...);
}
