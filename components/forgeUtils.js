const fs = require('fs');
const path = require('path');
const zip = require('adm-zip');

const EventEmitter = require('events');

const child = require('child_process');

const request = require('request');
const {parse} = require('node-html-parser');

class ForgeUtils extends EventEmitter {
    static forgeUrl = 'https://files.minecraftforge.net';

    constructor(lib, version, minecraft) {
        super();

        this.paths = {
            lib: lib,
            version: version,
            minecraft: minecraft,
        };
    }

    async prepareProcessors(installProfile) {
        installProfile.processors = installProfile.processors.map(pc => {
            pc.args = pc.args.map(arg => {
                if (arg[0] !== '{') {
                    return arg[0] === '[' ? ForgeUtils.processPath(this.paths.lib, ForgeUtils.removeBraces(arg)) : arg;
                }

                let argValue = {};
                let argKey = ForgeUtils.removeBraces(arg);

                for (const subKey in installProfile.data[argKey]) {
                    if (argKey === 'BINPATCH') {
                        return argValue[subKey] = path.join(this.paths.version, installProfile.data[argKey][subKey]);
                    }

                    argValue[subKey] = ForgeUtils.processPath(
                        this.paths.lib,
                        ForgeUtils.removeBraces(installProfile.data[argKey][subKey])
                    );
                }

                if (argKey === 'MINECRAFT_JAR') {
                    arg = this.paths.minecraft;
                }

                return argValue.client ? argValue.client : arg;
            });

            if (pc.outputs) {
                const outValues = {};

                for (const out in pc.outputs) {
                    const outKey = ForgeUtils.removeBraces(out);
                    const outValue = installProfile.data[`${outKey}_SHA`].client;
                    const outValueKey = ForgeUtils.processPath(
                        this.paths.lib,
                        ForgeUtils.removeBraces(installProfile.data[outKey].client)
                    );

                    outValues[outValueKey] = outValue;
                }

                pc.outputs = outValues;
            }

            return pc;
        });

        await this.installForgeProcessors(installProfile);
    }

    installForgeProcessors(installProfile) {
        this.emit('install-start');

        installProfile.processors.forEach(proc => {

            const pathJar = ForgeUtils.processPath(this.paths.lib, proc.jar);

            if (!fs.existsSync(pathJar)) {
                return console.error(pathJar);
            }

            const classes = [...proc.classpath, proc.jar]
                .map(proc => ForgeUtils.processPath(this.paths.lib, proc))
                .join(process.platform === 'win32' ? ';' : ':');


            const result = child.spawnSync('java', [
                '-cp',
                classes,
                ForgeUtils.searchMainClass(pathJar),
                ...proc.args
            ]);


            if (result.stdout) {
                this.emit('install-data', result.stdout.toString('utf-8'));
            }

            if (result.stderr) {
                this.emit('install-error', result.stderr.toString('utf-8'));
            }
        });

        this.emit('install-finish');
    }

    static getForgeInstallerLink(version, isUniversal = false) {
        return new Promise(resolve => {
            request(ForgeUtils.forgeUrl + `/maven/net/minecraftforge/forge/index_${version}.html`,
                (err, response, body) => {
                    if (err) throw err;

                    const page = parse(body);
                    const downLoadLinks = page.querySelector('.download-list')
                        .querySelector('ul.download-links')
                        .querySelectorAll('a');

                    for (const link in downLoadLinks) {
                        const href = downLoadLinks[link].attributes.href;

                        if (!href
                            || href.includes('https')
                            || (isUniversal && !href.includes('universal'))
                            || (!isUniversal && !href.includes('installer'))) {
                            continue;
                        }

                        resolve(this.forgeUrl + href);
                        return;
                    }

                    response(null);
                })
        });
    }

    static detectForgeInstall(mcPath, version) {
        const versions = fs.readdirSync(
            path.join(mcPath, 'versions')
        );

        const forge = versions.findIndex(dir => {
            return dir.includes(`${version}-forge`);
        });

        if (forge === -1) {
            return null;
        }

        const versionId = ForgeUtils.getParseVersionId(versions[forge]);

        const forgeJar = path.join(mcPath, 'libraries', 'net', 'minecraftforge', 'forge', versionId, `forge-${versionId}.jar`,);
        const versionConfig = path.join(mcPath, 'versions', versions[forge], versions[forge] + '.json');

        if (!fs.existsSync(versionConfig) || !fs.existsSync(forgeJar)) {
            return null;
        }

        return {
            jar: forgeJar,
            version: versions[forge],
            config: require(versionConfig),
        };
    }

    static searchMainClass(pathJar) {
        const manifest = new zip(pathJar)
            .readAsText('META-INF/MANIFEST.MF')
            .trim();

        const mainClass = manifest.substring(
            manifest.search('Main-Class: ') + 'Main-Class: '.length
        );

        return mainClass;
    }

    static processPath(libPath, value) {
        const [main, type = 'jar'] = value.split('@');
        const [group, artifact = '', version = '', classifier = ''] = main.split(':');

        let groupPath = path.join(libPath, group.replace(/\./g, '/'), artifact, version, `${artifact}-${version}`);

        if (classifier) {
            groupPath += `-${classifier}`;
        }

        return `${groupPath}.${type}`;
    }

    static removeBraces(value) {
        return value.substring(1, value.length - 1);
    }

    static getParseVersionId(versionId) {
        return versionId.replace('-forge', '');
    }
};

module.exports = ForgeUtils;