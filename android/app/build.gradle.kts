import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

// ---------------------------------------------------------------------------------------
// Dev backend address (debug builds only)
//
// `10.0.2.2` is the *emulator's* NAT alias for the host machine's loopback. A physical
// phone is a separate machine on the LAN: it has no route to 10.0.2.2 at all, so a debug
// build hardcoded to it can never reach `cd backend && npm run dev`. The host is therefore
// resolved per build machine, in this order:
//
//   1. -Pzarvis.devApiHost=<host>   (command line, or any gradle.properties — including the
//                                    personal ~/.gradle/gradle.properties, see DEVELOPMENT.md)
//   2. ZARVIS_DEV_API_HOST env var  (CI / scripted builds)
//   3. this machine's LAN IPv4      (auto-detected: what a phone on the same Wi-Fi dials)
//   4. 10.0.2.2                     (last resort — emulator only; warned about below)
//
// Auto-detection is what makes "plug in a phone and Run" work with no setup: the address a
// phone needs is the address of the machine doing the build.
// ---------------------------------------------------------------------------------------

/** Interfaces that are never the LAN link a phone can reach (containers, VMs, VPNs, loopback). */
val virtualInterfacePrefixes = Regex("^(lo|docker|br-|veth|virbr|vmnet|vboxnet|tun|tap|utun|wg|zt|ham|awdl|llw)")

/** Real-hardware LAN IPv4 of the build machine, or null when there is no such interface. */
fun detectLanIpv4(): String? = runCatching {
    NetworkInterface.getNetworkInterfaces()
        .toList()
        .filter { candidate ->
            candidate.isUp && !candidate.isLoopback && !candidate.isVirtual &&
                !virtualInterfacePrefixes.containsMatchIn(candidate.name.lowercase())
        }
        // Wi-Fi/Ethernet first (a phone is almost always on the Wi-Fi link), then stable by index.
        .sortedWith(
            compareBy(
                { iface -> if (Regex("^(wl|en|eth|eno|enp|ens|wlp)").containsMatchIn(iface.name.lowercase())) 0 else 1 },
                { iface -> iface.index },
            ),
        )
        .flatMap { candidate -> candidate.inetAddresses.toList() }
        .filterIsInstance<Inet4Address>()
        .firstOrNull { address -> address.isSiteLocalAddress }
        ?.hostAddress
}.getOrNull()

/**
 * True for addresses that only ever exist inside a private network: loopback, RFC1918,
 * link-local, the emulator alias, and mDNS/`localhost` names. Cleartext HTTP is permitted
 * (below) only for these — pointing a debug build at a *public* host must not silently
 * downgrade that host's traffic to plaintext.
 */
fun isPrivateDevAddress(host: String): Boolean {
    val lower = host.lowercase()
    if (lower == "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) return true
    val octets = lower.split(".").mapNotNull { part -> part.toIntOrNull()?.takeIf { it in 0..255 } }
    if (octets.size != 4 || lower.split(".").size != 4) return false
    val (first, second) = octets
    return when {
        first == 127 -> true                       // loopback
        first == 10 -> true                        // RFC1918 (covers the 10.0.2.2 emulator alias)
        first == 192 && second == 168 -> true      // RFC1918
        first == 172 && second in 16..31 -> true   // RFC1918
        first == 169 && second == 254 -> true      // link-local
        else -> false
    }
}

val devApiHostFromProperty = (project.findProperty("zarvis.devApiHost") as String?)?.trim()?.ifEmpty { null }
val devApiHostFromEnv = System.getenv("ZARVIS_DEV_API_HOST")?.trim()?.ifEmpty { null }
val devApiHostDetected = if (devApiHostFromProperty == null && devApiHostFromEnv == null) detectLanIpv4() else null

val devApiHostResolution: Pair<String, String> = when {
    devApiHostFromProperty != null -> devApiHostFromProperty to "-Pzarvis.devApiHost"
    devApiHostFromEnv != null -> devApiHostFromEnv to "ZARVIS_DEV_API_HOST"
    devApiHostDetected != null -> devApiHostDetected to "auto-detected LAN address of this machine"
    else -> "10.0.2.2" to "fallback (no LAN interface found)"
}
val devApiHost: String = devApiHostResolution.first
val devApiHostSource: String = devApiHostResolution.second
val devApiPort = ((project.findProperty("zarvis.devApiPort") as String?) ?: System.getenv("ZARVIS_DEV_API_PORT"))
    ?.trim()?.ifEmpty { null } ?: "3000"
val devApiBaseUrl = "http://$devApiHost:$devApiPort/"

/**
 * Hosts the generated debug network security config permits cleartext to. The dev host is
 * included only when it is a private address; `10.0.2.2` (emulator) and loopback (`adb
 * reverse tcp:3000 tcp:3000`) are always included so one APK works on both emulator and
 * phone. Everything else keeps the platform's HTTPS-only default.
 */
val devCleartextHosts: List<String> = buildList {
    if (isPrivateDevAddress(devApiHost)) add(devApiHost)
    addAll(listOf("10.0.2.2", "127.0.0.1", "localhost"))
}.distinct()

logger.lifecycle("ZARVIS debug API base URL: $devApiBaseUrl  [host from $devApiHostSource]")
if (devApiHost == "10.0.2.2" && devApiHostSource.startsWith("fallback")) {
    logger.warn(
        "ZARVIS: falling back to the emulator alias 10.0.2.2 — a PHYSICAL DEVICE cannot reach it. " +
            "Build with -Pzarvis.devApiHost=<your-machine's-LAN-IP> (see DEVELOPMENT.md).",
    )
}
if (!isPrivateDevAddress(devApiHost)) {
    logger.warn(
        "ZARVIS: dev API host '$devApiHost' is not a private/LAN address, so cleartext HTTP to it is " +
            "NOT permitted by the generated network security config (it would downgrade a public host to " +
            "plaintext). Use an https:// backend for non-local hosts, or a LAN address for local dev.",
    )
}

// ---------------------------------------------------------------------------------------
// Release signing (Play Store submission / installing a release build on a real device)
//
// No production keystore is ever committed to this repository — secrets live outside
// source control (SECURITY.md). Credentials are resolved, in order:
//   1. RELEASE_STORE_FILE / RELEASE_STORE_PASSWORD / RELEASE_KEY_ALIAS / RELEASE_KEY_PASSWORD
//      environment variables (CI / scripted release builds)
//   2. app/keystore.properties (git-ignored; same 4 keys, for a local release build)
// When neither is present, `release` still builds — assembleRelease stays usable as a
// compile-verification step — but the output is UNSIGNED: installable on no device and
// impossible to upload to Play Console until real signing credentials exist. This mirrors
// the devApiHost resolution above: resolve what's available, warn loudly about what isn't,
// never fail the build for a missing credential that only matters at actual release time.
// ---------------------------------------------------------------------------------------
val keystorePropertiesFile = project.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) keystorePropertiesFile.inputStream().use { load(it) }
}

fun releaseSigningValue(propertyKey: String, envVar: String): String? =
    System.getenv(envVar)?.trim()?.ifEmpty { null }
        ?: keystoreProperties.getProperty(propertyKey)?.trim()?.ifEmpty { null }

val releaseStoreFile = releaseSigningValue("storeFile", "RELEASE_STORE_FILE")
val releaseStorePassword = releaseSigningValue("storePassword", "RELEASE_STORE_PASSWORD")
val releaseKeyAlias = releaseSigningValue("keyAlias", "RELEASE_KEY_ALIAS")
val releaseKeyPassword = releaseSigningValue("keyPassword", "RELEASE_KEY_PASSWORD")
val hasReleaseSigningConfig =
    releaseStoreFile != null && releaseStorePassword != null && releaseKeyAlias != null && releaseKeyPassword != null

if (!hasReleaseSigningConfig) {
    logger.warn(
        "ZARVIS: no release signing configuration found. Set RELEASE_STORE_FILE, " +
            "RELEASE_STORE_PASSWORD, RELEASE_KEY_ALIAS and RELEASE_KEY_PASSWORD (env vars) or create " +
            "app/keystore.properties with the same 4 keys (see DEVELOPMENT.md). assembleRelease will " +
            "still produce an APK/AAB, but it will be UNSIGNED: it cannot be installed on a device or " +
            "uploaded to Play Console until real signing credentials are supplied.",
    )
}

/**
 * Writes the debug-only `res/xml/network_security_config.xml`. Generated rather than
 * checked in because the one host that actually needs a cleartext exemption — the dev
 * machine's LAN address — is machine-specific, and Android's network security config can
 * only name literal hosts, never ranges. Generating it keeps the exemption scoped to the
 * exact host this build talks to instead of a blanket `base-config` that would permit
 * cleartext to every domain on the internet.
 */
abstract class GenerateNetworkSecurityConfig : DefaultTask() {

    /** Hosts to permit cleartext HTTP for. Everything else keeps the secure default. */
    @get:Input
    abstract val cleartextHosts: ListProperty<String>

    /** Recorded in a comment so the generated file explains itself when someone finds it. */
    @get:Input
    abstract val baseUrl: Property<String>

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun generate() {
        val xmlDir = outputDir.get().asFile.resolve("xml")
        xmlDir.mkdirs()
        val lines = buildList {
            add("""<?xml version="1.0" encoding="utf-8"?>""")
            add("<!--")
            add("  GENERATED by :app:$name — do not edit, and do not check in.")
            add("")
            add("  Debug builds talk to a local dev backend over plain HTTP (${baseUrl.get()}), which")
            add("  Android 9+ (API 28) blocks by default. Only the hosts listed below are exempted;")
            add("  every other destination keeps the platform's HTTPS-only default, including in debug.")
            add("  This whole file exists in debug builds only — release keeps the platform default and")
            add("  never sees a cleartext exemption (SECURITY.md).")
            add("-->")
            add("<network-security-config>")
            add("""    <base-config cleartextTrafficPermitted="false" />""")
            add("""    <domain-config cleartextTrafficPermitted="true">""")
            cleartextHosts.get().forEach { host ->
                add("""        <domain includeSubdomains="false">$host</domain>""")
            }
            add("    </domain-config>")
            add("</network-security-config>")
        }
        xmlDir.resolve("network_security_config.xml").writeText(lines.joinToString("\n", postfix = "\n"))
    }
}

android {
    namespace = "com.zarvismobile.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.zarvismobile.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    signingConfigs {
        if (hasReleaseSigningConfig) {
            create("release") {
                storeFile = file(releaseStoreFile!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        // API_BASE_URL is the app's only network destination (`ApiClientFactory` builds the
        // single Retrofit/OkHttp client, and `TokenAuthenticator` reuses the same base URL).
        // debug points at the local dev backend resolved above; release points at the
        // production domain the web client already uses (MASTER_SPEC.md §12a).
        debug {
            buildConfigField("String", "API_BASE_URL", "\"$devApiBaseUrl\"")
        }
        release {
            // Not yet enabled: this repository has no way to compile-verify a minified build
            // (no Android SDK in the sandbox that wrote this — see MASTER_SPEC.md §32), and
            // shipping an unverified R8 config is worse than shipping an unshrunk release.
            // A starter proguard-rules.pro is included; flip this once a real build confirms
            // the app still works minified.
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("String", "API_BASE_URL", "\"https://zarvismobile.com/\"")
            if (hasReleaseSigningConfig) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}

// The generated config is wired into the debug variant's resources only, so a release build
// has no `@xml/network_security_config` at all (app/src/debug/AndroidManifest.xml, which
// references it, is likewise debug-only).
androidComponents {
    onVariants(selector().withBuildType("debug")) { variant ->
        val generateTask = tasks.register<GenerateNetworkSecurityConfig>(
            "generate${variant.name.replaceFirstChar { it.uppercase() }}NetworkSecurityConfig",
        ) {
            description = "Generates the debug-only network security config scoped to the dev backend host."
            cleartextHosts.set(devCleartextHosts)
            baseUrl.set(devApiBaseUrl)
        }
        variant.sources.res?.addGeneratedSourceDirectory(generateTask, GenerateNetworkSecurityConfig::outputDir)
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(project(":domain"))
    implementation(project(":agents"))
    implementation(project(":skills"))
    implementation(project(":core:core-ui"))
    implementation(project(":core:core-common"))
    implementation(project(":core:core-security"))
    implementation(project(":core:core-tooling"))
    implementation(project(":data:data-remote"))
    implementation(project(":data:data-local"))
    implementation(project(":data:data-repository"))
    implementation(project(":features:feature-onboarding"))
    implementation(project(":features:feature-home"))
    implementation(project(":features:feature-conversation"))
    implementation(project(":features:feature-tasks"))
    implementation(project(":features:feature-developer"))
    implementation(project(":features:feature-subscription"))
    implementation(project(":features:feature-settings"))

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.activity.compose)
    implementation(libs.core.ktx)
    implementation(libs.navigation.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)

    implementation(libs.hilt.android)
    implementation(libs.hilt.navigation.compose)
    ksp(libs.hilt.compiler)

    implementation(libs.coroutines.core)
    implementation(libs.coroutines.android)
}
