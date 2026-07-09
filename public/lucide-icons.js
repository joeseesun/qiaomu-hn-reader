(() => {
  const icons = {
    "arrow-down-wide-narrow": [
      ["path", { d: "m3 16 4 4 4-4" }],
      ["path", { d: "M7 20V4" }],
      ["path", { d: "M11 4h10" }],
      ["path", { d: "M11 8h7" }],
      ["path", { d: "M11 12h4" }]
    ],
    "arrow-up-narrow-wide": [
      ["path", { d: "m3 8 4-4 4 4" }],
      ["path", { d: "M7 4v16" }],
      ["path", { d: "M11 12h4" }],
      ["path", { d: "M11 16h7" }],
      ["path", { d: "M11 20h10" }]
    ],
    bot: [
      ["path", { d: "M12 8V4H8" }],
      ["rect", { width: "16", height: "12", x: "4", y: "8", rx: "2" }],
      ["path", { d: "M2 14h2" }],
      ["path", { d: "M20 14h2" }],
      ["path", { d: "M15 13v2" }],
      ["path", { d: "M9 13v2" }]
    ],
    "message-square-text": [
      ["path", { d: "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" }],
      ["path", { d: "M7 11h10" }],
      ["path", { d: "M7 15h6" }],
      ["path", { d: "M7 7h8" }]
    ],
    newspaper: [
      ["path", { d: "M15 18h-5" }],
      ["path", { d: "M18 14h-8" }],
      ["path", { d: "M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2" }],
      ["rect", { width: "8", height: "4", x: "10", y: "6", rx: "1" }]
    ],
    radar: [
      ["path", { d: "M19.07 4.93A10 10 0 0 0 6.99 3.34" }],
      ["path", { d: "M4 6h.01" }],
      ["path", { d: "M2.29 9.62A10 10 0 1 0 21.31 8.35" }],
      ["path", { d: "M16.24 7.76A6 6 0 1 0 8.23 16.67" }],
      ["path", { d: "M12 18h.01" }],
      ["path", { d: "M17.99 11.66A6 6 0 0 1 15.77 16.67" }],
      ["circle", { cx: "12", cy: "12", r: "2" }],
      ["path", { d: "m13.41 10.59 5.66-5.66" }]
    ],
    "refresh-cw": [
      ["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }],
      ["path", { d: "M21 3v5h-5" }],
      ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }],
      ["path", { d: "M8 16H3v5" }]
    ],
    search: [
      ["path", { d: "m21 21-4.34-4.34" }],
      ["circle", { cx: "11", cy: "11", r: "8" }]
    ],
    star: [
      ["path", { d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" }]
    ],
    "trending-up": [
      ["path", { d: "M16 7h6v6" }],
      ["path", { d: "m22 7-8.5 8.5-5-5L2 17" }]
    ]
  };

  function attrsToString(attrs) {
    return Object.entries(attrs)
      .map(([key, value]) => `${key}="${String(value).replace(/"/g, "&quot;")}"`)
      .join(" ");
  }

  function iconMarkup(name) {
    const icon = icons[name];
    if (!icon) return "";
    return icon.map(([tag, attrs]) => `<${tag} ${attrsToString(attrs)}></${tag}>`).join("");
  }

  function render(root = document) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll("[data-lucide]").forEach((node) => {
      const name = node.getAttribute("data-lucide");
      const markup = iconMarkup(name);
      if (!markup) return;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svg.setAttribute("width", "24");
      svg.setAttribute("height", "24");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("data-lucide", name);
      svg.setAttribute("class", [node.getAttribute("class"), "lucide-icon"].filter(Boolean).join(" "));
      svg.innerHTML = markup;
      node.replaceWith(svg);
    });
  }

  window.qmLucide = { render, icons: Object.keys(icons) };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => render());
  } else {
    render();
  }
})();
