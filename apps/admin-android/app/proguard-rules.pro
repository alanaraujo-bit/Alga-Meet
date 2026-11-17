# kotlinx.serialization: keep generated serializers of the API models.
-keepattributes *Annotation*, InnerClasses
-keep,includedescriptorclasses class app.alga.admin.data.**$$serializer { *; }
-keepclassmembers class app.alga.admin.data.** { *** Companion; }
-keepclasseswithmembers class app.alga.admin.data.** { kotlinx.serialization.KSerializer serializer(...); }
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
