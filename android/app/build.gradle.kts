plugins {
    id("com.android.application") version "8.9.2"
    id("org.jetbrains.kotlin.android") version "2.1.21"
}

android {
    namespace = "pl.restaurantos.tablet"
    compileSdk = 35
    defaultConfig {
        applicationId = "pl.restaurantos.tablet"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "DEFAULT_SERVER", "\"\"")
    }
    buildTypes {
        debug {
            buildConfigField("String", "DEFAULT_SERVER", "\"http://10.0.2.2:3001\"")
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
