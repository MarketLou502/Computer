plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.aaron.echodash"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.aaron.echodash"
        // 23 covers both FireOS 6/7 (Android 7/9) and the LineageOS crown builds,
        // which are typically much newer. Keeps WebViewClient's modern
        // WebResourceError callback usable without a legacy fallback branch.
        minSdk = 23
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    // Deliberately minimal — no Compose, no Material, just enough to host a WebView.
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
}
