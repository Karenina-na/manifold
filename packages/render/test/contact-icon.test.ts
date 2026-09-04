import assert from "node:assert/strict";
import test from "node:test";
import { CONTACT_ICONS, resolveContactKey, contactIconLabel, isContactIconKey } from "../src/contact-icon.ts";

test("every listed contact icon resolves to itself", () => {
  for (const def of CONTACT_ICONS) {
    const key = def.key || "globe";
    assert.equal(resolveContactKey({ icon: key, label: def.label, url: "" }), key, `icon key ${def.key}`);
    assert.equal(contactIconLabel(key) !== "", true, `label exists for ${def.key}`);
    assert.equal(isContactIconKey(key), true);
  }
});

test("resolveContactKey infers brands from labels and urls", () => {
  assert.equal(resolveContactKey({ icon: "", label: "My GitHub", url: "" }), "github");
  assert.equal(resolveContactKey({ icon: "", label: "微信", url: "" }), "wechat");
  assert.equal(resolveContactKey({ icon: "", label: "", url: "https://github.com/x" }), "github");
  assert.equal(resolveContactKey({ icon: "", label: "", url: "https://wpa.qq.com/msgrd?v=3" }), "qq");
  assert.equal(resolveContactKey({ icon: "weixin", label: "Weixin", url: "" }), "wechat");
  assert.equal(resolveContactKey({ icon: "twitter", label: "X", url: "" }), "x");
  assert.equal(resolveContactKey({ icon: "", label: "YouTube", url: "" }), "youtube");
  assert.equal(resolveContactKey({ icon: "", label: "小红书", url: "" }), "xiaohongshu");
});

test("legacy keys keep mapping to their old rendering", () => {
  assert.equal(resolveContactKey({ icon: "flame", label: "Bilibili", url: "" }), "bilibili");
  assert.equal(resolveContactKey({ icon: "tv", label: "YouTube", url: "" }), "youtube");
  assert.equal(resolveContactKey({ icon: "message", label: "WhatsApp", url: "" }), "whatsapp");
});
