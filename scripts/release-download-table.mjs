#!/usr/bin/env node
/**
 * 릴리스 설명의 다운로드 표를 만든다. 플랫폼마다 어떤 파일을 받으면 되는지와 그 링크를 담는다.
 *
 *   node scripts/release-download-table.mjs <version> <owner/repo>          표를 출력한다
 *   node scripts/release-download-table.mjs --check <version> <owner/repo>  표의 파일이 모두 올라왔는지 확인한다
 *
 * 표는 빌드가 끝나기 전, 초안 릴리스를 만들 때 쓰인다. 그래서 파일 이름은 빌드가 내는 이름에서
 * 미리 정해 두고, 빌드가 끝난 뒤 `--check`로 실제 업로드와 맞는지 확인한다.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** 번들 파일 이름의 제품명. GitHub는 업로드한 파일 이름의 공백을 `.`으로 바꾼다. */
const PRODUCT = 'Markpad.Live';

/**
 * 사람이 받아서 설치하는 파일들. 업데이터만 쓰는 `.sig`, `.app.tar.gz`, `latest.json`은 뺀다.
 *
 * @param {string} version
 */
export function downloadAssets(version) {
	return {
		windowsX64: `${PRODUCT}_${version}_x64-setup.exe`,
		windowsArm64: `${PRODUCT}_${version}_arm64-setup.exe`,
		portableX64: `markpad-live_${version}_x64.exe`,
		portableArm64: `markpad-live_${version}_arm64.exe`,
		macos: `${PRODUCT}_${version}_universal.dmg`,
		appImage: `${PRODUCT}_${version}_amd64.AppImage`,
		deb: `${PRODUCT}_${version}_amd64.deb`,
		rpm: `${PRODUCT}-${version}-1.x86_64.rpm`,
	};
}

/**
 * @param {string} version
 * @param {string} repo `owner/name`
 */
export function downloadTable(version, repo) {
	const a = downloadAssets(version);
	const base = `https://github.com/${repo}/releases/download/v${version}`;
	/** @param {string} name @param {string} [label] */
	const link = (name, label = name) => `[${label}](${base}/${encodeURIComponent(name)})`;
	return [
		'## Download',
		'',
		'| System | File | Notes |',
		'| --- | --- | --- |',
		`| Windows (most PCs) | ${link(a.windowsX64)} | Installer. Updates itself when a new version is published. |`,
		`| Windows on ARM | ${link(a.windowsArm64)} | Installer for ARM64 PCs, such as Snapdragon laptops. Updates itself. |`,
		`| Windows, portable | ${link(a.portableX64, 'x64')} · ${link(a.portableArm64, 'ARM64')} | A single program file that runs without installing. Use the installer to get updates automatically. |`,
		`| macOS (Intel and Apple Silicon) | ${link(a.macos)} | Open it and drag Markpad Live to Applications. Updates itself. |`,
		`| Linux, any distribution | ${link(a.appImage)} | Make it executable (\`chmod +x\`) and run it. Updates itself. |`,
		`| Debian, Ubuntu | ${link(a.deb)} | \`sudo apt install ./${a.deb}\`. To update, install the newer \`.deb\` from the latest release. |`,
		`| Fedora, openSUSE | ${link(a.rpm)} | \`sudo dnf install ./${a.rpm}\`. To update, install the newer \`.rpm\` from the latest release. |`,
		'',
		'**macOS:** this build is not signed by Apple, so macOS stops it the first time. Open **System Settings › Privacy & Security** and choose **Open Anyway**, or run `xattr -dr com.apple.quarantine "/Applications/Markpad Live.app"` in Terminal.',
		'',
		'The `.sig` files, `Markpad.Live.app.tar.gz` and `latest.json` are for the in-app updater. You do not need to download them.',
	].join('\n');
}

/**
 * 표가 가리키는데 릴리스에 없는 파일.
 *
 * @param {string} version
 * @param {string[]} uploaded
 */
export function missingDownloads(version, uploaded) {
	const present = new Set(uploaded);
	return Object.values(downloadAssets(version)).filter((name) => !present.has(name));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const args = process.argv.slice(2);
	const check = args[0] === '--check';
	const [version, repo] = check ? args.slice(1) : args;
	if (!version || !repo) {
		console.error('usage: release-download-table.mjs [--check] <version> <owner/repo>');
		process.exit(2);
	}
	if (check) {
		const uploaded = execFileSync('gh', ['release', 'view', `v${version}`, '--repo', repo, '--json', 'assets', '--jq', '.assets[].name'], {
			encoding: 'utf8',
		})
			.split('\n')
			.filter(Boolean);
		const missing = missingDownloads(version, uploaded);
		if (missing.length > 0) {
			console.error(`The download table links files that v${version} does not have:\n  ${missing.join('\n  ')}`);
			process.exit(1);
		}
		console.log(`Every file in the download table is attached to v${version}.`);
	} else {
		console.log(downloadTable(version, repo));
	}
}
