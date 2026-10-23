plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.rasseed.agent"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.rasseed.agent"
        // Android 7.1 (SDK 25) and up. The silent USSD API needs 8.0+, so on 7.x balance
        // checks always go through the accessibility dialer fallback.
        minSdk = 25
        targetSdk = 36
        versionCode = 3
        versionName = "1.2.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key so it can be side-loaded on the agent phones.
            // Replace with your own keystore before distributing more widely.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { buildConfig = true }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
}
