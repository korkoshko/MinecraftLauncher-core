const fs = require('fs');
const path = require('path');
const zip = require('adm-zip');

const EventEmitter = require('events');

const child = require('child_process');

const request = require('request');
const {parse} = require('node-html-parser');

class OptiFineUtils extends EventEmitter {
    static optiFineUrl = 'https://optifine.net/';

    constructor(java, installer, minecraft) {
        super();

        this.installer = installer;
        this.minecraft = minecraft;
        this.java = java;
    }

    install() {
        this.emit('install-start');

        const separator = process.platform === 'win32' ? ';' : ':';
        const result = child.spawnSync(this.java, [
            '-cp',
            `${path.join(__dirname, '..', 'optifineinstaller')}${separator}${this.installer}`,
            'OptiFineInstaller',
            this.minecraft
        ]);

        if (result.stdout) {
            this.emit('install-data', result.stdout.toString('utf-8'));
        }

        if (result.stderr) {
            this.emit('install-error', result.stderr.toString('utf-8'));
        }

        this.emit('install-finish');
    }

    static getOptiFineInstallerLink(version) {
        return new Promise(resolve => {
            request(OptiFineUtils.optiFineUrl + 'downloads',
                (err, response, body) => {
                    if (err) throw err;

                    const page = parse(body);
                    const downloadVersions = page.querySelectorAll('td.downloadLineFileFirst');

                    for (const key in downloadVersions) {
                        const rawText = downloadVersions[key].rawText;

                        if (rawText.includes(version + ' ')) {
                            const jar = rawText.replace(/\s/g, '_') + '.jar';
                            resolve(`${OptiFineUtils.optiFineUrl}download?f=${jar}`);
                            return;
                        }
                    }
                    resolve(null);
                })
        });
    }

    static detectOptiFineInstall(mcPath, version) {
        const versions = fs.readdirSync(
            path.join(mcPath, 'versions')
        );

        const optifine = versions.findIndex(dir => {
            return dir.includes(`${version}-OptiFine`);
        });

        if (optifine === -1) {
            return null;
        }

        const versionId = versions[optifine];

        const optiFineJar = path.join(mcPath, 'versions', versionId, versionId + '.jar');
        const versionConfig = path.join(mcPath, 'versions', versionId, versionId + '.json');

        if (!fs.existsSync(versionConfig) || !fs.existsSync(optiFineJar)) {
            return null;
        }

        return {
            jar: optiFineJar,
            version: versionId,
            config: require(versionConfig),
        };
    }

    static getParseVersionId(version, target) {
        let parseDownloadLink = target.split('H')[1].split('.');
        return `${version}-OptiFine_H${parseDownloadLink[0]}`;
    }
};

module.exports = OptiFineUtils;