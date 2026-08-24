import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const messageBusFilter = /node_modules[\\/]@liff[\\/]message-bus[\\/]lib[\\/]index\.es\.js$/;
const unsafeEval = `null===(a=null==i?void 0:i.contentWindow)||void 0===a||a.window.eval("(".concat(T.toString().replace("$MESSAGE_HANDLER_URL","".concat("https://liff-subwindow.line.me/liff/v2/sub/messageHandler")).replace("$IDENTIFIER",e.split("'")[0]),")()"))`;
const safeMessageHandler = `(function(frame,identifier){var frameDocument=frame.contentDocument;if(!frameDocument||!frameDocument.body)throw new Error("Unable to initialize LIFF message handler");var form=frameDocument.createElement("form");form.method="POST";form.action="https://liff-subwindow.line.me/liff/v2/sub/messageHandler";var input=frameDocument.createElement("input");input.type="hidden";input.name="identifier";input.value=identifier;form.appendChild(input);frameDocument.body.appendChild(form);form.submit()})(i,e)`;

const cspSafeMessageBus = {
  name: 'points-card-csp-safe-liff-message-bus',
  setup(buildContext) {
    buildContext.onLoad({ filter: messageBusFilter }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const occurrenceCount = source.split(unsafeEval).length - 1;
      if (occurrenceCount !== 1) {
        throw new Error(`Expected one LIFF message-bus eval path, found ${occurrenceCount}. Review the pinned SDK before rebuilding.`);
      }
      return {
        contents: source.replace(unsafeEval, safeMessageHandler),
        loader: 'js',
        resolveDir: dirname(args.path)
      };
    });
  }
};

await build({
  entryPoints: [join(projectRoot, 'shared/liff-client.entry.js')],
  outfile: join(projectRoot, 'vendor/liff-client.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  legalComments: 'linked',
  banner: {
    js: '/* PointsCard LIFF bundle: @line/liff 2.29.2 with CSP-safe message-handler bootstrap. Rebuild with npm run build:liff. */'
  },
  plugins: [cspSafeMessageBus]
});

const output = await readFile(join(projectRoot, 'vendor/liff-client.js'), 'utf8');
if (/\beval\s*\(/.test(output) || /new\s+Function\s*\(/.test(output)) {
  throw new Error('Generated LIFF bundle still contains dynamic JavaScript evaluation.');
}

