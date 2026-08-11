const APP = process.env.APP_URL ?? 'https://qaforge-ai-tau.vercel.app';
const PROJECT =
  process.argv[2] ?? 'cmsm2hox50005k4013l7emd35';

async function collectJs(html) {
  return [...html.matchAll(/\/_next\/static\/[^"']+\.js/g)].map((m) => m[0]);
}

const pages = [
  `${APP}/login`,
  `${APP}/app/projects`,
  `${APP}/app/projects/${PROJECT}`,
];

const paths = new Set();
for (const url of pages) {
  const html = await (await fetch(url)).text();
  const build = html.match(/\/_next\/static\/([A-Za-z0-9_-]+)\//);
  console.log(url, 'build?', build?.[1] ?? 'n/a', 'len', html.length);
  for (const p of await collectJs(html)) paths.add(p);
  // also pull build manifest if present
  const bid = build?.[1];
  if (bid && bid !== 'chunks' && bid !== 'css' && bid !== 'media') {
    for (const manifest of [
      `/_next/static/${bid}/_buildManifest.js`,
      `/_next/static/${bid}/_ssgManifest.js`,
    ]) {
      try {
        const body = await (await fetch(`${APP}${manifest}`)).text();
        for (const p of await collectJs(body)) paths.add(p);
        for (const m of body.matchAll(/static\/chunks\/[^"']+\.js/g)) {
          paths.add(`/_next/${m[0]}`);
        }
      } catch {
        /* ignore */
      }
    }
  }
}

console.log('unique js', paths.size);
const found = {
  reviewTestCases: false,
  continuePlanning: false,
  stage1Handoff: false,
  documentedCases: false,
  generateStrategy: false,
  stepOf10: false,
  browsingCompleted: false,
};

for (const path of paths) {
  try {
    const js = await (await fetch(`${APP}${path}`)).text();
    if (js.includes('Review test cases')) found.reviewTestCases = true;
    if (js.includes('Continue to Test Planning')) found.continuePlanning = true;
    if (js.includes('Stage 1')) found.stage1Handoff = true;
    if (js.includes('Documented test cases')) found.documentedCases = true;
    if (js.includes('Generate strategy')) found.generateStrategy = true;
    if (js.includes('Step ') && js.includes(' of 10')) found.stepOf10 = true;
    if (js.includes('Browsing completed step')) found.browsingCompleted = true;
  } catch {
    /* ignore */
  }
}
console.log(JSON.stringify(found, null, 2));
