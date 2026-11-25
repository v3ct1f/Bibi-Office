import { describe, expect, it } from "vitest";
import { htmlToText, sanitizeHtml } from "../src/sanitize.ts";

const clean = (h: string) => sanitizeHtml(h).html;

describe("sanitizeHtml", () => {
  it("keeps ordinary formatting", () => {
    expect(clean("<p>Hi <b>there</b></p>")).toBe("<p>Hi <b>there</b></p>");
  });
  it("removes scripts, styles, frames and their content", () => {
    const out = clean("a<script>alert(1)</script>b<style>body{x:y}</style><iframe src=//x></iframe>c<object data=x></object>");
    expect(out).toBe("abc");
  });
  it("removes event handlers and javascript: links, however they are spelled", () => {
    expect(clean('<a href="javascript:alert(1)" onclick="x()">go</a>')).toBe("<a>go</a>");
    expect(clean('<a href="  JaVa\tScRiPt:alert(1)">go</a>')).toBe("<a>go</a>");
    expect(clean('<a href="&#106;avascript:alert(1)">go</a>')).toBe("<a>go</a>");
    expect(clean('<a href="data:text/html;base64,PHNjcmlwdD4=">go</a>')).toBe("<a>go</a>");
    expect(clean('<img src=x onerror=alert(1)>')).not.toMatch(/onerror|alert/);
    expect(clean('<div onmouseover="x()" style="color:red">t</div>')).toBe('<div style="color:red">t</div>');
  });
  it("opens links safely", () => {
    expect(clean('<a href="https://example.com/x?a=1&b=2">x</a>')).toBe('<a href="https://example.com/x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow">x</a>');
    expect(clean('<a href="mailto:a@b.co">m</a>')).toContain('href="mailto:a@b.co"');
  });
  it("does not load pictures from the internet, but says there were some", () => {
    const r = sanitizeHtml('<img src="https://tracker.test/p.gif" width="1">');
    expect(r.hasRemoteImages).toBe(true);
    expect(r.html).not.toContain(' src=');
    expect(r.html).toContain("data-remote-src");
    expect(sanitizeHtml('<img src="data:image/png;base64,AAAA">').html).toContain('src="data:image/png;base64,AAAA"');
    expect(clean('<img src="data:image/svg+xml;base64,AAAA">')).not.toContain("svg");
  });
  it("drops styles that load things or cover the page", () => {
    expect(clean('<p style="background:url(http://x/y);color:red">t</p>')).toBe('<p style="color:red">t</p>');
    expect(clean('<p style="position:fixed;top:0">t</p>')).toBe("<p>t</p>");
    expect(clean('<p style="width:expression(alert(1))">t</p>')).toBe("<p>t</p>");
  });
  it("neutralises broken and nested markup", () => {
    expect(clean("<scr<script>ipt>alert(1)</scr</script>ipt>")).not.toMatch(/<script/i);
    expect(clean('<img src="x"onerror="alert(1)">')).not.toMatch(/onerror/);
    expect(clean("<b><i>x")).toBe("<b><i>x</i></b>");
    expect(clean("1 < 2 > 0")).toBe("1 &lt; 2 &gt; 0");
    expect(clean('<form action="http://evil"><input name=x><button>go</button></form>')).not.toMatch(/form|input|button/);
    expect(clean('<svg onload=alert(1)><script>1</script></svg>x')).toBe("x");
    expect(clean("<!-- <script>alert(1)</script> -->ok")).toBe("ok");
  });
  it("turns html into plain text", () => {
    expect(htmlToText("<p>Hello&nbsp;<b>you</b></p><p>Bye</p><script>x</script>")).toContain("Hello");
    expect(htmlToText("<p>a</p><p>b</p>")).toBe("a\n\nb".replace("\n\n", "\n"));
  });
});
