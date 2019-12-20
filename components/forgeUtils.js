const fs = require('fs');
const path = require('path');
const zip = require('adm-zip');
const child = require('child_process');

class ForgeUtils {
    constructor(lib, version, minecraft) {
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
        installProfile.processors.forEach(proc => {

            console.log(proc);
            const pathJar = ForgeUtils.processPath(this.paths.lib, proc.jar);

            if (!fs.existsSync(pathJar)) {
                return console.error(pathJar);
            }

            const classes = [...proc.classpath, proc.jar]
                .map(proc => ForgeUtils.processPath(this.paths.lib, proc))
                .join(':');

            // TODO: Add forge success / error event

            const result = child.spawnSync('java', [
                '-cp',
                classes,
                ForgeUtils.searchMainClass(pathJar),
                ...proc.args
            ]);

            console.log(result.stdout.toString('utf-8'));
            console.error(result.stderr.toString('utf-8'));
        });
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