import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import i18next from "i18next";
import { en } from "./i18n-en.ts";
import { zhCN } from "./i18n-zh-cn.ts";
import { localeCookie, parseAcceptLanguage, parseLocale, parseLocaleCookie, resolveLocale } from "./locale.ts";

const resources = {
  en: { translation: en },
  "zh-CN": { translation: zhCN },
};

async function createTranslator(locale) {
  const instance = i18next.createInstance();
  await instance.init({
    resources,
    lng: locale,
    fallbackLng: "en",
    supportedLngs: Object.keys(resources),
    interpolation: { escapeValue: false },
    initImmediate: false,
    showSupportNotice: false,
  });
  return instance;
}

test("locale parsing honors cookie precedence and Accept-Language quality", () => {
  assert.equal(parseLocale("EN_us"), "en");
  assert.equal(parseLocale("zh-Hans-CN"), "zh-CN");
  assert.equal(parseLocale("fr-FR"), null);
  assert.equal(parseAcceptLanguage("fr-FR;q=1, zh-CN;q=0.9, en;q=0.8"), "zh-CN");
  assert.equal(parseAcceptLanguage("zh-CN;q=0, en-US;q=0.7"), "en");
  assert.equal(resolveLocale("zh-CN", "en-US"), "zh-CN");
  assert.equal(resolveLocale("fr-FR", "en-GB"), "en");
  assert.equal(parseLocaleCookie("theme=dark; manifold.locale=zh-CN; other=1"), "zh-CN");
  assert.equal(parseLocaleCookie("manifold.locale=%E0%A4%A"), null);
  assert.match(localeCookie("zh-CN", true), /^manifold\.locale=zh-CN; path=\/; max-age=31536000; samesite=lax; secure$/);
});

test("English and Simplified Chinese resources keep exact key parity", () => {
  assert.deepEqual(Object.keys(zhCN).sort(), Object.keys(en).sort());
});

test("fixed product and protocol labels stay outside locale resources", () => {
  const fixedKeys = [
    "common.inMotion",
    "footer.powered",
    "footer.counting",
    "footer.online_one",
    "footer.online_other",
    "comments.discussion",
    "chain.eyebrow",
    "chain.mining",
    "chain.height",
    "chain.commitments",
    "chain.proof",
    "chain.siteKey",
    "chain.spine",
    "chain.verify",
    "chain.anchor",
    "chain.ledger",
    "chain.proofPath",
  ];

  for (const key of fixedKeys) {
    assert.equal(key in en, false, `${key} should not be localized in English`);
    assert.equal(key in zhCN, false, `${key} should not be localized in Simplified Chinese`);
  }
});

test("fixed product and protocol labels render directly at their call sites", () => {
  const writing = fs.readFileSync(new URL("../features/archive/writing-archive-view.tsx", import.meta.url), "utf8");
  const thoughts = fs.readFileSync(new URL("../features/archive/thought-archive-view.tsx", import.meta.url), "utf8");
  const chain = fs.readFileSync(new URL("../app/chain/page.tsx", import.meta.url), "utf8");
  const explorer = fs.readFileSync(new URL("../features/chain/chain-explorer.tsx", import.meta.url), "utf8");
  const comments = fs.readFileSync(new URL("../features/comments/comment-thread.tsx", import.meta.url), "utf8");
  const footer = fs.readFileSync(new URL("../components/layout/site-footer.tsx", import.meta.url), "utf8");

  assert.match(writing, /> In motion<\/span>/);
  assert.match(thoughts, /> In motion<\/span>/);
  assert.match(chain, /> Mining<\/span>/);
  assert.match(chain, />◇ Anchoring chain<\/span>/);
  assert.match(comments, /className=\{styles\.eyebrow\}>Discussion<\/span>/);
  for (const label of ["◇ Spine", "✦ Verify", "↗ Anchor", "◈ Ledger", "⌁ Proof path"]) {
    assert.match(explorer, new RegExp(`className=\\{styles\\.eyebrow\\}>${label}<`));
  }
  for (const label of ["Height", "Commitments", "Proof", "Site key"]) {
    assert.match(explorer, new RegExp(`label="${label}"`));
  }
  assert.match(footer, />Powered by <strong>Manifold<\/strong>/);
  assert.match(footer, /"Counting readers"/);
  assert.match(footer, /"reader" : "readers"/);
});

test("home section eyebrow labels render directly at their call sites", () => {
  const home = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const timeline = fs.readFileSync(new URL("../features/home/update-timeline-view.tsx", import.meta.url), "utf8");

  for (const label of ["Profile", "Background", "Recent content", "My Series", "Contact"]) {
    assert.match(home, new RegExp(`className=\\{styles\\.eyebrow\\}>${label}<`));
  }
  assert.match(timeline, /className=\{styles\.eyebrow\}>Updates</);
});

test("every plural resource has both one and other forms", () => {
  for (const key of Object.keys(en)) {
    const match = /_(one|other)$/.exec(key);
    if (!match) continue;
    const base = key.slice(0, -match[0].length);
    assert.ok(`${base}_one` in en, `${base} is missing its English singular form`);
    assert.ok(`${base}_other` in en, `${base} is missing its English plural form`);
    assert.ok(`${base}_one` in zhCN, `${base} is missing its Chinese singular-form key`);
    assert.ok(`${base}_other` in zhCN, `${base} is missing its Chinese plural-form key`);
  }
});

test("English count labels select grammatical singular and plural resources", async () => {
  const i18n = await createTranslator("en");
  const cases = [
    ["common.views", "1 view", "2 views"],
    ["common.likes", "1 like", "2 likes"],
    ["common.comments", "1 comment", "2 comments"],
    ["common.words", "1 word", "2 words"],
    ["common.publishedNotes", "1 published note", "2 published notes"],
    ["chain.blocksTotal", "1 block", "2 blocks"],
    ["chain.certCount", "1 cert", "2 certs"],
    [
      "chain.merkleSealed",
      "1 certificate merkle-sealed · replayed against the full chain on every check",
      "2 certificates merkle-sealed · replayed against the full chain on every check",
    ],
  ];

  for (const [key, singular, plural] of cases) {
    assert.equal(i18n.t(key, { count: 1 }), singular);
    assert.equal(i18n.t(key, { count: 2 }), plural);
  }
});

test("detail, homepage metadata, and chain labels resolve in both locales", async () => {
  const keys = [
    "detail.backWriting",
    "detail.backThoughts",
    "detail.articleMetadata",
    "detail.thoughtDiscussion",
    "home.metadata.sections",
    "home.metadata.jump",
    "home.metadata.jumpTo",
    "chain.genesis",
    "chain.tip",
    "chain.recomputed",
    "chain.stored",
    "chain.match",
    "chain.root",
  ];

  for (const locale of ["en", "zh-CN"]) {
    const i18n = await createTranslator(locale);
    for (const key of keys) {
      assert.notEqual(i18n.t(key, { section: "Profile" }), key, `${key} did not resolve for ${locale}`);
    }
  }
});
