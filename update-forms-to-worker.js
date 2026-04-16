// Retarget all lead-capture forms at the deployed Cloudflare Worker.
// Run after `wrangler deploy` with the worker URL as the only argument:
//
//   node update-forms-to-worker.js https://mmm-lead-capture.<subdomain>.workers.dev/capture-lead
//
// Effect: rewrites the inline <script> block inside every v2 lead-capture
// section to POST the simplified payload (firstName, email, referrerPage,
// utmCampaign) to the Worker instead of hitting Zapier directly. The Worker
// does URL parsing + Zapier fan-out + Resend send.
//
// Idempotent: once a page has been retargeted, the marker bumps to
// `lead-capture-v3` so re-runs with the same URL are no-ops. Re-running with
// a NEW URL re-writes the block.

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const MARKER_V2 = 'lead-capture-v2';
const MARKER_V3 = 'lead-capture-v3';

const workerUrl = process.argv[2];
if (!workerUrl || !/^https:\/\/[^/]+\.workers\.dev\//.test(workerUrl)) {
    console.error('Usage: node update-forms-to-worker.js https://<subdomain>.workers.dev/<path>');
    console.error('       (a valid Cloudflare Workers URL with a trailing path, e.g. /capture-lead)');
    process.exit(1);
}

// New inline JS: minimal payload, Worker handles parsing + routing.
const NEW_FORM_JS = `
(function(){
  window.submitLead = async function(e) {
    e.preventDefault();
    var form = e.target;
    var btn = form.querySelector('button');
    var originalLabel = btn.innerHTML;
    btn.textContent = 'Sending...';
    btn.disabled = true;

    var data = {
      firstName: document.getElementById('firstName').value.trim(),
      email: document.getElementById('email').value.trim(),
      referrerPage: window.location.pathname,
      utmCampaign: new URLSearchParams(window.location.search).get('utm_campaign') || ''
    };

    try {
      var res = await fetch(${JSON.stringify(workerUrl)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('worker-' + res.status);

      form.style.display = 'none';
      document.getElementById('formSuccess').style.display = 'block';

      if (window.gtag) {
        gtag('event', 'lead_capture', {
          page: window.location.pathname,
          campaign: data.utmCampaign
        });
      }
    } catch (err) {
      btn.innerHTML = originalLabel;
      btn.disabled = false;
      document.getElementById('formError').style.display = 'block';
    }
  };
})();
`;

// Replace EITHER a v2 block or an existing v3 block (to allow URL rotation).
// Match: `<!-- lead-capture-vN -->` ... through the <script> that follows
// the .lead-capture-section div, up to and including </script>.
const BLOCK_RE = new RegExp(
    '<!--\\s*(' + MARKER_V2 + '|' + MARKER_V3 + ')\\s*-->' +
    '([\\s\\S]*?)' +                   // the div + its innards
    '<script>[\\s\\S]*?</script>',
    'g'
);

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.html'));
let updated = 0, skipped = 0, noBlock = 0;

for (const file of files) {
    const full = path.join(DIR, file);
    let html = fs.readFileSync(full, 'utf8');

    if (!BLOCK_RE.test(html)) { noBlock++; continue; }
    BLOCK_RE.lastIndex = 0;

    let changed = false;
    const newHtml = html.replace(BLOCK_RE, (_match, _marker, body) => {
        const newBlock = `<!-- ${MARKER_V3} -->` + body.trimEnd() + `\n<script>${NEW_FORM_JS}</script>`;
        changed = true;
        return newBlock;
    });

    if (!changed) { skipped++; continue; }

    if (newHtml === html) { skipped++; continue; }
    fs.writeFileSync(full, newHtml, 'utf8');
    updated++;
}

console.log(`Retargeted at Worker:  ${updated}`);
console.log(`Unchanged:             ${skipped}`);
console.log(`No form block (skip):  ${noBlock}`);
console.log(`Worker URL:            ${workerUrl}`);
