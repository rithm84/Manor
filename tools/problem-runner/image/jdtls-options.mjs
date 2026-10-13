/** JVM options for jdtls, shared by the image's bake step and lsp.mjs: the class-data archive maps only when they match. */
export const jdtlsJvmOptions = ['-Xms64m', '-Xmx384m', '-XX:+UseSerialGC', '-XX:TieredStopAtLevel=1', '-Declipse.application=org.eclipse.jdt.ls.core.id1', '-Dosgi.bundles.defaultStartLevel=4', '-Declipse.product=org.eclipse.jdt.ls.core.product', '--add-modules=ALL-SYSTEM', '--add-opens', 'java.base/java.util=ALL-UNNAMED', '--add-opens', 'java.base/java.lang=ALL-UNNAMED']
export const jdtlsLauncher = ['-jar', '/opt/jdtls/launcher.jar']
