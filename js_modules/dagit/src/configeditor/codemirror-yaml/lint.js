// Patched lint mode that won't constantly lint
import CodeMirror from "codemirror";

var GUTTER_ID = "CodeMirror-lint-markers";

function showTooltip(e, content, node) {
  var tt = document.createElement("div");
  var nodeRect = node.getBoundingClientRect();

  tt.className = "CodeMirror-lint-tooltip";
  tt.appendChild(content.cloneNode(true));
  document.body.appendChild(tt);
  tt.style.top = nodeRect.top - tt.clientHeight - 5 + "px";
  tt.style.left = nodeRect.left + 5 + "px";
  if (tt.style.opacity != null) tt.style.opacity = 1;
  return tt;
}
function rm(elt) {
  if (elt.parentNode) elt.parentNode.removeChild(elt);
}
function hideTooltip(tt) {
  if (!tt.parentNode) return;
  if (tt.style.opacity == null) rm(tt);
  tt.style.opacity = 0;
  setTimeout(function() {
    rm(tt);
  }, 600);
}

function showTooltipFor(e, content, node) {
  var tooltip = showTooltip(e, content, node);
  function hide() {
    CodeMirror.off(node, "mouseout", hide);
    if (tooltip) {
      hideTooltip(tooltip);
      tooltip = null;
    }
  }
  var poll = setInterval(function() {
    if (tooltip)
      for (var n = node; ; n = n.parentNode) {
        if (n && n.nodeType == 11) n = n.host;
        if (n == document.body) return;
        if (!n) {
          hide();
          break;
        }
      }
    if (!tooltip) return clearInterval(poll);
  }, 400);
  CodeMirror.on(node, "mouseout", hide);
}

function parseOptions(_cm, options) {
  if (options instanceof Function) return { getAnnotations: options };
  if (!options || options === true) options = {};
  return options;
}

function clearMarks(cm) {
  var state = cm.state.lint;
  if (state.hasGutter) cm.clearGutter(GUTTER_ID);
  for (var i = 0; i < state.marked.length; ++i) state.marked[i].clear();
  state.marked.length = 0;
}

function makeMarker(labels, severity, multiple, tooltips) {
  var marker = document.createElement("div"),
    inner = marker;
  marker.className = "CodeMirror-lint-marker-" + severity;
  if (multiple) {
    inner = marker.appendChild(document.createElement("div"));
    inner.className = "CodeMirror-lint-marker-multiple";
  }

  if (tooltips != false) {
    CodeMirror.on(inner, "mouseover", function(e) {
      showTooltipFor(e, labels, inner);
    });
  }
  return marker;
}

function getMaxSeverity(a, b) {
  if (a == "error") return a;
  else return b;
}

function groupByLine(annotations) {
  var lines = [];
  for (var i = 0; i < annotations.length; ++i) {
    var ann = annotations[i],
      line = ann.from.line;
    (lines[line] || (lines[line] = [])).push(ann);
  }
  return lines;
}

function annotationTooltip(ann) {
  var severity = ann.severity;
  if (!severity) severity = "error";
  var tip = document.createElement("div");
  tip.className = "CodeMirror-lint-message-" + severity;
  if (typeof ann.messageHTML != "undefined") {
    tip.innerHTML = ann.messageHTML;
  } else {
    tip.appendChild(document.createTextNode(ann.message));
  }
  return tip;
}

function updateLinting(cm, annotationsNotSorted) {
  clearMarks(cm);
  var state = cm.state.lint,
    options = state.options;

  var annotations = groupByLine(annotationsNotSorted);

  for (var line = 0; line < annotations.length; ++line) {
    var anns = annotations[line];
    if (!anns) continue;

    var maxSeverity = null;
    var tipLabel = state.hasGutter && document.createDocumentFragment();

    for (var i = 0; i < anns.length; ++i) {
      var ann = anns[i];
      var severity = ann.severity;
      if (!severity) severity = "error";
      maxSeverity = getMaxSeverity(maxSeverity, severity);

      if (options.formatAnnotation) ann = options.formatAnnotation(ann);
      if (state.hasGutter) tipLabel.appendChild(annotationTooltip(ann));

      if (ann.to)
        state.marked.push(
          cm.markText(ann.from, ann.to, {
            className: "CodeMirror-lint-mark-" + severity,
            __annotation: ann
          })
        );
    }

    if (state.hasGutter)
      cm.setGutterMarker(
        line,
        GUTTER_ID,
        makeMarker(
          tipLabel,
          maxSeverity,
          anns.length > 1,
          state.options.tooltips
        )
      );
  }
  if (options.onUpdateLinting)
    options.onUpdateLinting(annotationsNotSorted, annotations, cm);
}

function lintAsync(cm, getAnnotations, passOptions) {
  var state = cm.state.lint;
  var id = ++state.waitingFor;
  function abort() {
    id = -1;
    cm.off("change", abort);
  }
  cm.on("change", abort);
  getAnnotations(
    cm.getValue(),
    function(annotations, arg2) {
      cm.off("change", abort);
      if (state.waitingFor != id) return;
      if (arg2 && annotations instanceof CodeMirror) annotations = arg2;
      cm.operation(function() {
        updateLinting(cm, annotations);
      });
    },
    passOptions,
    cm
  );
}

function startLinting(cm) {
  var state = cm.state.lint,
    options = state.options;
  /*
   * Passing rules in `options` property prevents JSHint (and other linters) from complaining
   * about unrecognized rules like `onUpdateLinting`, `delay`, `lintOnChange`, etc.
   */
  var passOptions = options.options || options;
  var getAnnotations =
    options.getAnnotations || cm.getHelper(CodeMirror.Pos(0, 0), "lint");
  if (!getAnnotations) return;
  if (options.async || getAnnotations.async) {
    lintAsync(cm, getAnnotations, passOptions);
  } else {
    var annotations = getAnnotations(cm.getValue(), passOptions, cm);
    if (!annotations) return;
    if (annotations.then)
      annotations.then(function(issues) {
        cm.operation(function() {
          updateLinting(cm, issues);
        });
      });
    else
      cm.operation(function() {
        updateLinting(cm, annotations);
      });
  }
}

function onChange(cm) {
  var state = cm.state.lint;
  if (!state) return;
  clearTimeout(state.timeout);
  state.timeout = setTimeout(function() {
    startLinting(cm);
  }, state.options.delay || 500);
}

function popupTooltip(docs, annotations, e) {
  var target = e.target || e.srcElement;

  var tooltip = document.createDocumentFragment();

  if (docs) {
    var docsEl = document.createElement("div");
    docsEl.textContent = docs;
    tooltip.appendChild(docsEl);
    if (annotations.length) {
      docsEl.style.paddingBottom = "4px";
      docsEl.style.marginBottom = "4px";
      docsEl.style.borderBottom = "1px solid rgba(0,0,0,0.25)";
    }
  }

  for (var i = 0; i < annotations.length; i++) {
    var ann = annotations[i];
    tooltip.appendChild(annotationTooltip(ann));
  }
  showTooltipFor(e, tooltip, target);
}

function onMouseOver(cm, e) {
  var target = e.target || e.srcElement;
  var box = target.getBoundingClientRect(),
    x = (box.left + box.right) / 2,
    y = (box.top + box.bottom) / 2;
  var pos = cm.coordsChar({ left: x, top: y }, "client");
  var spans = cm.findMarksAt(pos);

  var getDocs = cm.getHelper(CodeMirror.Pos(0, 0), "dagster-docs");
  var docs = getDocs(cm, pos);

  var annotations = [];
  for (var i = 0; i < spans.length; ++i) {
    var ann = spans[i].__annotation;
    if (ann) annotations.push(ann);
  }

  if (docs || annotations.length) {
    popupTooltip(docs, annotations, e);
  }
}

function LintState(cm, options, hasGutter) {
  this.marked = [];
  this.options = options;
  this.timeout = null;
  this.hasGutter = hasGutter;
  this.onMouseOver = function(e) {
    onMouseOver(cm, e);
  };
  this.waitingFor = 0;
}

CodeMirror.defineOption("lint", false, function(cm, val, old) {
  if (old && old != CodeMirror.Init) {
    clearMarks(cm);
    if (cm.state.lint.options.lintOnChange !== false)
      cm.off("change", onChange);
    CodeMirror.off(
      cm.getWrapperElement(),
      "mouseover",
      cm.state.lint.onMouseOver
    );
    clearTimeout(cm.state.lint.timeout);
    delete cm.state.lint;
  }

  if (val) {
    var gutters = cm.getOption("gutters"),
      hasLintGutter = false;
    for (var i = 0; i < gutters.length; ++i)
      if (gutters[i] == GUTTER_ID) hasLintGutter = true;
    var state = (cm.state.lint = new LintState(
      cm,
      parseOptions(cm, val),
      hasLintGutter
    ));
    if (state.options.lintOnChange !== false) cm.on("change", onChange);
    if (state.options.tooltips != false && state.options.tooltips != "gutter")
      CodeMirror.on(cm.getWrapperElement(), "mouseover", state.onMouseOver);
  }

  // XXX(freiksenet): This is commented out because currently codemirror
  // reloads plugins on every change, causing infinite linting
  // startLinting(this);
});

CodeMirror.defineExtension("performLint", function() {
  if (this.state.lint) startLinting(this);
});
