import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import javax.inject.Inject

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

/**
 * Copies the repo-root `web/` folder (the SA Maps web app) into
 * build/generated/webassets/web/ which is registered as an assets source dir, so the
 * files end up in the APK under assets/web/ and are served by WebViewAssetLoader at
 * https://appassets.androidplatform.net/assets/web/index.html
 * Works when web/ is missing or empty (produces an empty folder).
 */
abstract class SyncWebAssetsTask : DefaultTask() {
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val webFiles: ConfigurableFileCollection

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @get:Inject
    abstract val fs: FileSystemOperations

    @TaskAction
    fun syncWeb() {
        val dest = outputDir.dir("web").get().asFile
        fs.sync {
            from(webFiles)
            into(dest)
        }
        dest.mkdirs()
    }
}

val webSourceDir = rootProject.file("../web")

val syncWebAssets = tasks.register<SyncWebAssetsTask>("syncWebAssets") {
    group = "build"
    description = "Copies ../web into build/generated/webassets/web for packaging as assets."
    webFiles.from(
        fileTree(webSourceDir) {
            exclude("**/.DS_Store", "**/Thumbs.db", "**/node_modules/**", "**/.git/**")
        }
    )
    outputDir.set(layout.buildDirectory.dir("generated/webassets"))
}

android {
    namespace = "com.samaps.app"
    compileSdk = 36
    buildToolsVersion = "36.0.0"

    defaultConfig {
        applicationId = "com.samaps.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(syncWebAssets.flatMap { it.outputDir })
        }
    }

    androidResources {
        // Default aapt pattern drops "_*" folders and dotfiles; keep everything the web app ships
        // except VCS/OS junk.
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~"
    }

    lint {
        // Lint is run explicitly (lintDebug); do not block release assembly on it.
        checkReleaseBuilds = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

// Make sure web assets are synced before any asset merge (and anything else reading assets).
tasks.configureEach {
    if ((name.startsWith("merge") && name.endsWith("Assets")) ||
        (name.startsWith("lint") || name.contains("Lint"))
    ) {
        dependsOn(syncWebAssets)
    }
}

dependencies {
    implementation(libs.androidx.car.app)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.ktx)
}
