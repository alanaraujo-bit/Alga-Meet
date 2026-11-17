plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// FCM needs the owner's Firebase project (app/google-services.json, never committed). Without it the app builds and
// works with the live stream ("modo plantão") instead of FCM.
val hasFirebase = file("google-services.json").exists()
if (hasFirebase) apply(plugin = "com.google.gms.google-services")

android {
    namespace = "app.alga.admin"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.alga.admin"
        minSdk = 31
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("boolean", "HAS_FIREBASE", hasFirebase.toString())
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // shortcut: signed with the debug key so the owner can install it; a release keystore before any store upload.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.06.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.fragment:fragment-ktx:1.8.8")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-process:2.9.1")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.work:work-runtime-ktx:2.10.1")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:okhttp-sse:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")
    implementation("dev.chrisbanes.haze:haze:1.6.0")
    implementation(platform("com.google.firebase:firebase-bom:33.15.0"))
    implementation("com.google.firebase:firebase-messaging")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
