# Vendored browser dependencies

PointsCard keeps security-sensitive browser dependencies in this directory so the Admin Console does not execute arbitrary third-party CDN JavaScript inside an authenticated administrator session.

## qrcode-generator 2.0.4

- Package: `qrcode-generator`
- Version: `2.0.4`
- License: MIT
- Upstream repository: `kazuhikoarase/qrcode-generator`
- Upstream source path: `js/dist/qrcode.js`
- Upstream Git blob SHA reviewed for this vendoring: `df13f829bf41f36b82f0ed85751ed3b4c39cfeb8`
- Local browser file: `qrcode-generator-2.0.4.js`

The Admin Console loads only the local copy. Any future update must keep the version explicit, review the upstream diff, run `tests/supply-chain.test.js`, and pass the full PointsCard CI suite before release.
