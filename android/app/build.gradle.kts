plugins {
    id("com.android.application") version "8.9.2"
    id("org.jetbrains.kotlin.android") version "2.1.21"
}

android {
    namespace = "pl.restaurantos.tablet"
    compileSdk = 35
    defaultConfig {
        applicationId = "pl.restaurantos.tablet"
        minSdk = 24
        targetSdk = 35
        versionCode = 4
        versionName = "0.3.1"
        buildConfigField("String", "DEFAULT_SERVER", "\"https://restaurantos.maxstronytest.uk\"")
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
