const child = require('child_process');
const path = require('path');
const handler = require('./handler');
const fs = require('fs');
const EventEmitter = require('events').EventEmitter;

const ForgeUtils = require('./forgeUtils');
const OptiFineUtils = require('./optiFineUtils');

class MCLCore extends EventEmitter {
    constructor() {
        super();
    }

    async launch(options) {
        this.options = options;
        this.options.root = path.resolve(this.options.root);

        const mcVersion = this.options.version.number;

        // Simplified overrides so launcher devs can set the paths to what ever they want. see docs for variable names.
        if (!this.options.overrides) this.options.overrides = {url: {}};
        if (!this.options.overrides.url) this.options.overrides.url = {};

        this.options.overrides.url = {
            meta: this.options.overrides.url.meta || "https://launchermeta.mojang.com",
            resource: this.options.overrides.url.resource || "https://resources.download.minecraft.net",
            mavenForge: this.options.overrides.url.mavenForge || "http://files.minecraftforge.net/maven/",
            defaultRepoForge: this.options.overrides.url.defaultRepoForge || "https://libraries.minecraft.net/",
            fallbackMaven: this.options.overrides.url.fallbackMaven || "https://search.maven.org/remotecontent?filepath="
        };

        this.handler = new handler(this);
        // Lets the events register. our magic switch!
        await void (0);

        this.emit('debug', `[MCLC]: MCLC version ${require(path.join(__dirname, '..', 'package.json')).version}`);
        const java = await this.handler.checkJava(this.options.javaPath || 'java');

        if (!java.run) {
            this.emit('debug', `[MCLC]: Couldn't start Minecraft due to: ${java.message}`);
            this.emit('close', 1);
            return null;
        }

        if (!fs.existsSync(this.options.root)) {
            this.emit('debug', '[MCLC]: Attempting to create root folder');
            fs.mkdirSync(this.options.root);
        }

        if (this.options.clientPackage) {
            this.emit('debug', `[MCLC]: Extracting client package to ${this.options.root}`);
            await this.handler.extractPackage();
        }

        if (this.options.installer) {
            this._launcherProfiles();
            await this.handler.runInstaller(this.options.installer)
        }

        this.options.directory = this.options.overrides.directory
            || path.join(this.options.root, 'versions', mcVersion);

        // Version JSON for the main launcher folder
        const versionFile = await this.handler.getVersion();

        // Custom auth lib
        if (this.options.authLib) {
            versionFile.libraries = this._authLibProcess(versionFile.libraries);
        }

        const mcPath = this.options.overrides.minecraftJar
            || this.handler.getVersionPath(this.options.version.custom || mcVersion);

        const nativePath = await this.handler.getNatives();

        if (this.options.version.optifine) {
            this.options.version.custom = await this._optifineProcess(mcPath, mcVersion);
        } else {
            await this._downloadJar(mcPath, false);
        }

        let forge = null, custom = null;

        if (this.options.version.forge) {
            forge = await this._forgeProcess(mcVersion);
        }

        if (this.options.version.custom) {
            this.emit('debug', '[MCLC]: Detected custom in options, setting custom version file');
            custom = require(path.join(this.options.root, 'versions', this.options.version.custom, `${this.options.version.custom}.json`));
        }

        const args = [];

        // Jvm
        let jvm = [
            '-XX:-UseAdaptiveSizePolicy',
            '-XX:-OmitStackTraceInFastThrow',
            '-Dfml.ignorePatchDiscrepancies=true',
            '-Dfml.ignoreInvalidMinecraftCertificates=true',
            `-Djava.library.path=${nativePath}`,
            `-Xmx${this.options.memory.max}M`,
            `-Xms${this.options.memory.min}M`
        ];

        if (this.handler.getOS() === 'osx') {
            if (parseInt(versionFile.id.split('.')[1]) > 12) jvm.push(await this.handler.getJVM());
        } else {
            jvm.push(await this.handler.getJVM());
        }

        if (this.options.customArgs) {
            jvm = jvm.concat(this.options.customArgs);
        }

        const classPaths = ['-cp'];
        const classes = this.options.overrides.classes || await handler.cleanUp(await this.handler.getClasses());

        const separator = this._getJavaSeparator();

        this.emit('debug', `[MCLC]: Using ${separator} to separate class paths`);

        if (forge) {
            this.emit('debug', '[MCLC]: Setting Forge class paths');

            classPaths.push(`${forge.jar}${separator}${forge.paths.join(separator)}${separator}${classes.join(separator)}${separator}${mcPath}`);
            classPaths.push(forge.config.mainClass);
        } else if (this.options.version.optifine) {
            const jar = fs.existsSync(mcPath) ? `${separator}${mcPath}` : '';

            classPaths.push(`${classes.join(separator)}${jar}`);
            classPaths.push(custom.mainClass);
        } else {
            const file = custom || versionFile;
            const jar = fs.existsSync(mcPath) ? `${mcPath}${separator}` : '';

            classPaths.push(`${jar}${classes.join(separator)}`);
            classPaths.push(file.mainClass);
        }

        // Download version's assets
        this.emit('debug', '[MCLC]: Attempting to download assets');
        await this.handler.getAssets();

        if (this.options.onlyInstall) {
            return null;
        }

        // Launch options. Thank you Lyrus for the reformat <3

        const modification = forge ? forge.config : custom || null;
        const launchOptions = await this.handler.getLaunchOptions(modification, !!forge);

        const launchArguments = args.concat(jvm, classPaths, launchOptions);

        this.emit('arguments', launchArguments);
        this.emit('debug', launchArguments.join(' '));

        const minecraft = child.spawn(this.options.javaPath ? `"${this.options.javaPath}"` : 'java', launchArguments,
            {cwd: this.options.overrides.cwd || this.options.root, shell: true});

        minecraft.stdout.on('data', (data) => this.emit('data', data.toString('utf-8')));
        minecraft.stderr.on('data', (data) => this.emit('data', data.toString('utf-8')));

        minecraft.on('close', (code) => this.emit('close', code));
        minecraft.on('error', (error) => this.emit('launch-error', error));

        return minecraft;
    }

    async _forgeProcess(mcVersion) {
        let forge = await ForgeUtils.detectForgeInstall(this.options.root, mcVersion);

        const isLegacy = this._isLegacyVersion(mcVersion);

        if (forge) {
            this.emit('debug', `[MCLC]: Forge detected: ${forge.version}`);

            forge.paths = isLegacy ? await this.handler.getForgeDependenciesLegacy(forge.config.libraries) :
                await this.handler.getForgeDependencies(forge.config.libraries);
        } else {
            this.emit('debug', `[MCLC]: Forge not installed: ${mcVersion}. Attempting to download forge installer`);

            const forgeInstaller = await this.handler.downloadForgeInstaller(mcVersion, isLegacy);

            this._launcherProfiles();

            forge = isLegacy ?
                await this.handler.installForgeLegacy(forgeInstaller) :
                await this.handler.installForge(forgeInstaller);

            // forge.paths = await this.handler.getForgeDependencies(forge.config.libraries);
        }
        return forge;
    }

    async _optifineProcess(mcPath, mcVersion) {
        let optifine = await OptiFineUtils.detectOptiFineInstall(this.options.root, mcVersion);

        if (optifine) {
            this.emit('debug', `[MCLC]: OptiFine detected: ${optifine.version}`);
        } else {
            this.emit('debug', `[MCLC]: OptiFine not installed: ${mcVersion}. Attempting to download OptiFine installer`);
            optifine = await this.handler.downloadOptiFineInstaller(mcVersion);

            await this._downloadJar(mcPath, true);

            this._launcherProfiles();
            this.handler.installOptiFine(optifine.installer);
        }

        return optifine.version;
    }

    _authLibProcess(libs) {
        return libs.map(lib => {
            if (lib.name.includes('authlib')) {
                lib.downloads.artifact = this.options.authLib;
            }
            return lib;
        });
    }

    async _downloadJar(mcPath, force = false) {
        if (!fs.existsSync(mcPath) || force) {
            this.emit('debug', '[MCLC]: Attempting to download Minecraft version jar');
            await this.handler.getJar();
        }
    }

    _launcherProfiles() {
        const profilePath = path.join(this.options.root, 'launcher_profiles.json');

        if (!fs.existsSync(profilePath)) {
            fs.writeFileSync(profilePath, JSON.stringify({}, null, 4));
        }
    }

    _isLegacyVersion(mcVersion) {
        return this.handler.parseVersion(mcVersion).minor < 13;
    }

    _getJavaSeparator() {
        return this.handler.getOS() === "windows" ? ";" : ":";
    }
}

module.exports = MCLCore;