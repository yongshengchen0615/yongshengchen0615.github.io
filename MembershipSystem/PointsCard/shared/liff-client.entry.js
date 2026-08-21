import liff from '@line/liff/core';
import GetDecodedIDToken from '@line/liff/get-decoded-id-token';
import GetIDToken from '@line/liff/get-id-token';
import IsInClient from '@line/liff/is-in-client';
import IsLoggedIn from '@line/liff/is-logged-in';
import Login from '@line/liff/login';
import Logout from '@line/liff/logout';
import ScanCodeV2 from '@line/liff/scan-code-v2';

// Keep the bundle limited to APIs PointsCard actually calls. In particular,
// omitting the full CDN SDK avoids its sub-window eval path under strict CSP.
liff.use(new IsInClient());
liff.use(new IsLoggedIn());
liff.use(new GetIDToken());
liff.use(new GetDecodedIDToken());
liff.use(new Login());
liff.use(new Logout());
liff.use(new ScanCodeV2());

Object.defineProperty(window, 'PointsCardLiff', {
  value: liff,
  writable: false,
  configurable: false,
  enumerable: false
});

