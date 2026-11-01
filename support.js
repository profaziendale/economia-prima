/* Motore autonomo delle lezioni: legge il modello <x-dc> della pagina,
   esegue la logica (class Component) e ridisegna solo ciò che cambia. */
(function () {
  'use strict';

  var hide = document.createElement('style');
  hide.textContent = 'x-dc{display:none!important}';
  document.head.appendChild(hide);

  var comp = null, tree = null, root = null, oldKids = [], pending = false, uid = 0;

  function schedule() {
    if (pending) return;
    pending = true;
    Promise.resolve().then(function () { pending = false; render(); });
  }

  window.DCLogic = class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(upd, cb) {
      var patch = typeof upd === 'function' ? upd(this.state, this.props) : upd;
      this.state = Object.assign({}, this.state, patch);
      schedule();
      if (cb) Promise.resolve().then(cb);
    }
    forceUpdate() { schedule(); }
  };

  // ---------- compilazione del modello ----------
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

  function compile(node) {
    if (node.nodeType === 3) {
      if (!node.nodeValue.length) return null;
      return { t: 'text', raw: node.nodeValue, id: ++uid };
    }
    if (node.nodeType !== 1) return null;
    var tag = node.localName;
    var kids = [];
    node.childNodes.forEach(function (c) { var d = compile(c); if (d) kids.push(d); });
    if (tag === 'sc-if') return { t: 'if', value: node.getAttribute('value'), kids: kids, id: ++uid };
    if (tag === 'sc-for') return { t: 'for', list: node.getAttribute('list'), as: node.getAttribute('as') || 'item', kids: kids, id: ++uid };
    var attrs = [];
    for (var i = 0; i < node.attributes.length; i++) {
      var a = node.attributes[i];
      if (a.name.indexOf('hint-') === 0) continue;
      // src="{{…}}" e d="{{…}}" arrivano come data-dc-src / data-dc-d, così il browser non li carica prima del tempo
      var nm = a.name.indexOf('data-dc-') === 0 ? a.name.slice(8) : a.name;
      attrs.push({ name: nm, raw: a.value });
    }
    return { t: 'el', tag: node.tagName, ns: node.namespaceURI, attrs: attrs, kids: kids, id: ++uid };
  }

  // ---------- valutazione dei {{buchi}} ----------
  function lookup(scope, path) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return parseFloat(path);
    if (/^'.*'$|^".*"$/.test(path)) return path.slice(1, -1);
    var parts = path.split('.'), v = scope;
    for (var i = 0; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }
  function evalAttr(raw, scope) {
    var m = raw.match(WHOLE);
    if (m) return lookup(scope, m[1]);
    if (raw.indexOf('{{') < 0) return raw;
    return raw.replace(HOLE, function (_, p) { var v = lookup(scope, p); return v == null ? '' : String(v); });
  }

  // ---------- costruzione dei nodi virtuali ----------
  function build(list, scope, path, out) {
    list.forEach(function (d) {
      var key = d.id + path;
      if (d.t === 'text') {
        out.push({ text: evalAttr(d.raw, scope), key: key });
      } else if (d.t === 'if') {
        if (evalAttr(d.value, scope)) build(d.kids, scope, path, out);
      } else if (d.t === 'for') {
        var arr = evalAttr(d.list, scope) || [];
        arr.forEach(function (item, i) {
          var s = Object.create(scope);
          s[d.as] = item;
          s.$index = i;
          build(d.kids, s, path + ':' + d.id + '.' + i, out);
        });
      } else {
        var props = {};
        d.attrs.forEach(function (a) { props[a.name] = evalAttr(a.raw, scope); });
        var kids = [];
        build(d.kids, scope, path, kids);
        out.push({ tag: d.tag, ns: d.ns, props: props, kids: kids, key: key });
      }
    });
    return out;
  }

  // ---------- applicazione al DOM ----------
  var BOOL = { disabled: 1, checked: 1, selected: 1, readonly: 1, hidden: 1, required: 1, multiple: 1 };

  function fixUrl(name, v) {
    if (typeof v !== 'string') return v;
    if (name === 'src' && v.indexOf('/_blob/') === 0) return 'img/' + v.slice(7) + '.svg';
    if (name === 'href') {
      var m = v.match(/^\/?([A-Za-z0-9_-]+)\.dc\.html(#.*)?$/);
      if (m) return (m[1] === 'Main' ? 'index' : m[1]) + '.html' + (m[2] || '');
    }
    return v;
  }

  function eventName(el, name) {
    var ev = name.slice(2);
    if (ev === 'change') {
      var t = el.localName;
      var type = (el.getAttribute('type') || '').toLowerCase();
      if (t === 'textarea' || (t === 'input' && type !== 'checkbox' && type !== 'radio' && type !== 'file')) return 'input';
    }
    return ev;
  }

  function setProp(el, name, v, old) {
    if (name.length > 2 && name.indexOf('on') === 0) {
      var ev = eventName(el, name);
      el.__h = el.__h || {};
      if (!(ev in el.__h)) el.addEventListener(ev, function (e) { var f = el.__h[ev]; if (typeof f === 'function') f(e); });
      el.__h[ev] = v;
      return;
    }
    v = fixUrl(name, v);
    if (v === old && name !== 'value') return;
    if (name === 'style') { el.style.cssText = v == null ? '' : String(v); return; }
    if (name === 'value' && (el.localName === 'input' || el.localName === 'textarea' || el.localName === 'select')) {
      var s = v == null ? '' : String(v);
      if (el.value !== s) el.value = s;
      return;
    }
    if (BOOL[name]) {
      var on = v === '' || (v !== false && v != null && v !== 'false');
      el[name === 'readonly' ? 'readOnly' : name] = on;
      if (on) el.setAttribute(name, ''); else el.removeAttribute(name);
      return;
    }
    if (v == null || v === false) el.removeAttribute(name);
    else el.setAttribute(name, String(v));
  }

  function create(v) {
    if ('text' in v) { v.dom = document.createTextNode(v.text); return v.dom; }
    var el = v.ns && v.ns !== 'http://www.w3.org/1999/xhtml' ? document.createElementNS(v.ns, v.tag) : document.createElement(v.tag);
    v.dom = el;
    Object.keys(v.props).forEach(function (k) { setProp(el, k, v.props[k], undefined); });
    patchKids(el, [], v.kids);
    return el;
  }

  function same(a, b) { return ('text' in a) === ('text' in b) && a.tag === b.tag; }

  function update(o, n) {
    n.dom = o.dom;
    if ('text' in n) { if (o.text !== n.text) n.dom.nodeValue = n.text; return; }
    var el = n.dom;
    Object.keys(o.props).forEach(function (k) { if (!(k in n.props)) setProp(el, k, null, o.props[k]); });
    Object.keys(n.props).forEach(function (k) { setProp(el, k, n.props[k], o.props[k]); });
    patchKids(el, o.kids, n.kids);
  }

  function patchKids(parent, olds, news) {
    var byKey = {};
    olds.forEach(function (o) { byKey[o.key] = o; });
    var used = {};
    news.forEach(function (n) {
      var o = byKey[n.key];
      if (o && same(o, n)) { update(o, n); used[n.key] = 1; }
      else create(n);
    });
    olds.forEach(function (o) { if (!used[o.key] && o.dom.parentNode === parent) parent.removeChild(o.dom); });
    var cur = parent.firstChild;
    news.forEach(function (n) {
      if (n.dom !== cur) parent.insertBefore(n.dom, cur);
      else cur = cur.nextSibling;
    });
  }

  function render() {
    var vals = comp.renderVals() || {};
    var news = build(tree, vals, '', []);
    patchKids(root, oldKids, news);
    oldKids = news;
  }

  // ---------- avvio ----------
  function boot() {
    var x = document.querySelector('x-dc');
    if (!x) return;
    var helmet = x.querySelector('helmet');
    if (helmet) {
      Array.prototype.slice.call(helmet.children).forEach(function (c) { document.head.appendChild(c); });
      helmet.parentNode.removeChild(helmet);
    }
    tree = [];
    x.childNodes.forEach(function (c) { var d = compile(c); if (d) tree.push(d); });
    root = document.createElement('div');
    x.parentNode.replaceChild(root, x);

    var sc = document.querySelector('script[type="text/x-dc"]');
    var Cls = new Function('DCLogic', sc.textContent + '\nreturn Component;')(window.DCLogic);
    comp = new Cls({});
    comp.props = comp.props || {};
    render();
    if (typeof comp.componentDidMount === 'function') comp.componentDidMount();
    window.addEventListener('pagehide', function () {
      if (typeof comp.componentWillUnmount === 'function') comp.componentWillUnmount();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
