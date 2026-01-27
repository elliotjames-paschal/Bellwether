// ============================================================================
// Bellwether Sandbox — Frontend
// ============================================================================
// Streaming client for the OpenAI Responses API via Cloudflare Worker.
// Handles SSE parsing, pipeline step animation, output rendering,
// conversation history, and workspace save/download.
// ============================================================================

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------
  var WORKER_URL = "https://bellwether-sandbox.YOUR_SUBDOMAIN.workers.dev";
  // ^^^ Replace with actual Worker URL after deploying

  var PASSWORD = sessionStorage.getItem("sandboxPassword") || "";
  var conversation = [];
  var isRunning = false;
  var abortController = null;

  // Workspace: saved items in localStorage
  var WORKSPACE_KEY = "bellwether_workspace";

  // ---------------------------------------------------------------------------
  // DOM refs (set on init)
  // ---------------------------------------------------------------------------
  var inputEl, runBtn, outputEl, pipelineSteps, newConvoBtn;

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  function init() {
    inputEl = document.getElementById("researchInput");
    runBtn = document.getElementById("runAnalysis");
    outputEl = document.getElementById("outputContainer");
    pipelineSteps = document.querySelectorAll(".pipeline-step");
    newConvoBtn = document.getElementById("newConversation");

    if (!inputEl || !runBtn || !outputEl) return;

    // Wire up run button
    runBtn.addEventListener("click", handleRun);

    // Enter key in textarea (Ctrl+Enter or Cmd+Enter to submit)
    inputEl.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (!runBtn.disabled) handleRun();
      }
    });

    // Input validation
    inputEl.addEventListener("input", function () {
      runBtn.disabled = inputEl.value.trim().length < 10 || isRunning;
    });

    // New conversation button
    if (newConvoBtn) {
      newConvoBtn.addEventListener("click", function () {
        conversation = [];
        outputEl.innerHTML = "";
        resetPipeline();
        inputEl.focus();
      });
    }

    // Load workspace
    renderWorkspace();
  }

  // ---------------------------------------------------------------------------
  // Pipeline steps
  // ---------------------------------------------------------------------------
  function activateStep(n) {
    // n is 0-indexed
    for (var i = 0; i < pipelineSteps.length; i++) {
      if (i < n) {
        pipelineSteps[i].classList.remove("active");
        pipelineSteps[i].classList.add("complete");
      } else if (i === n) {
        pipelineSteps[i].classList.add("active");
        pipelineSteps[i].classList.remove("complete");
      } else {
        pipelineSteps[i].classList.remove("active", "complete");
      }
    }
  }

  function resetPipeline() {
    for (var i = 0; i < pipelineSteps.length; i++) {
      pipelineSteps[i].classList.remove("active", "complete");
    }
  }

  function completePipeline() {
    for (var i = 0; i < pipelineSteps.length; i++) {
      pipelineSteps[i].classList.remove("active");
      pipelineSteps[i].classList.add("complete");
    }
  }

  // ---------------------------------------------------------------------------
  // Main run handler
  // ---------------------------------------------------------------------------
  function handleRun() {
    var question = inputEl.value.trim();
    if (question.length < 10 || isRunning) return;

    isRunning = true;
    runBtn.disabled = true;
    runBtn.textContent = "Running...";
    abortController = new AbortController();

    // Show the question in output
    appendUserMessage(question);

    // Activate first pipeline step
    activateStep(0);

    // Stream the response
    streamResearch(question)
      .then(function () {
        completePipeline();
      })
      .catch(function (err) {
        if (err.name !== "AbortError") {
          appendError("Error: " + (err.message || "Unknown error"));
        }
        resetPipeline();
      })
      .finally(function () {
        isRunning = false;
        runBtn.disabled = inputEl.value.trim().length < 10;
        runBtn.textContent = "Run Analysis";
        abortController = null;
      });

    inputEl.value = "";
    runBtn.disabled = true;
  }

  // ---------------------------------------------------------------------------
  // Streaming fetch
  // ---------------------------------------------------------------------------
  function streamResearch(question) {
    var body = {
      question: question,
      password: PASSWORD,
      conversation: conversation,
    };

    return fetch(WORKER_URL + "/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: abortController ? abortController.signal : undefined,
    }).then(function (response) {
      if (!response.ok) {
        return response.json().then(function (err) {
          throw new Error(err.error || "Request failed");
        });
      }
      return processStream(response.body, question);
    });
  }

  // ---------------------------------------------------------------------------
  // SSE stream processor
  // ---------------------------------------------------------------------------
  function processStream(body, question) {
    var reader = body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    var currentTextEl = null;
    var currentText = "";
    var codeBlocks = [];
    var imageUrls = [];
    var sawCodeInterpreter = false;
    var sawTextOutput = false;
    var responseId = null;
    var containerId = null;

    // Create assistant message container
    var msgEl = document.createElement("div");
    msgEl.className = "output-message assistant-message";
    outputEl.appendChild(msgEl);

    function processLine(line) {
      if (!line.startsWith("data: ")) return;
      var data = line.slice(6).trim();
      if (data === "[DONE]") return;

      try {
        var evt = JSON.parse(data);
      } catch (e) {
        return;
      }

      var type = evt.type || "";

      // Track response/container IDs
      if (type === "response.created" && evt.response) {
        responseId = evt.response.id;
        activateStep(0); // Parse question
      }

      // Text content streaming
      if (type === "response.output_text.delta") {
        if (!sawTextOutput) {
          sawTextOutput = true;
          activateStep(sawCodeInterpreter ? 4 : 1); // Generate Report or Design Methodology
        }
        var delta = evt.delta || "";
        currentText += delta;
        renderText(msgEl, currentText);
      }

      if (type === "response.output_text.done") {
        renderText(msgEl, currentText);
      }

      // Code interpreter events
      if (type === "response.code_interpreter_call.in_progress" ||
          type === "response.code_interpreter_call_code.delta") {
        if (!sawCodeInterpreter) {
          sawCodeInterpreter = true;
          activateStep(2); // Query Data
        }
      }

      if (type === "response.code_interpreter_call_code.done") {
        var code = evt.data || "";
        if (code) {
          codeBlocks.push(code);
          appendCodeBlock(msgEl, code);
        }
        activateStep(3); // Run Analysis
      }

      if (type === "response.code_interpreter_call.interpreting") {
        activateStep(3); // Run Analysis
      }

      // Output items that may contain images
      if (type === "response.output_item.done" && evt.item) {
        var item = evt.item;
        // Check for code interpreter output with images
        if (item.type === "code_interpreter_call") {
          var results = item.results || [];
          for (var i = 0; i < results.length; i++) {
            var result = results[i];
            if (result.type === "image") {
              var fileId = result.file_id;
              var cid = result.container_id || containerId;
              if (fileId && cid) {
                var imgUrl = WORKER_URL + "/api/file?container_id=" +
                  encodeURIComponent(cid) + "&file_id=" + encodeURIComponent(fileId);
                appendImage(msgEl, imgUrl);
                imageUrls.push(imgUrl);
              }
            }
          }
        }
      }

      // Track container ID from various events
      if (evt.container_id) {
        containerId = evt.container_id;
      }
      if (evt.response && evt.response.container_id) {
        containerId = evt.response.container_id;
      }

      // Response complete
      if (type === "response.completed" || type === "response.done") {
        // Check for images in the final response output
        if (evt.response && evt.response.output) {
          for (var j = 0; j < evt.response.output.length; j++) {
            var out = evt.response.output[j];
            if (out.type === "code_interpreter_call" && out.results) {
              for (var k = 0; k < out.results.length; k++) {
                if (out.results[k].type === "image") {
                  var fid = out.results[k].file_id;
                  var cntId = out.results[k].container_id || containerId;
                  if (fid && cntId) {
                    var url = WORKER_URL + "/api/file?container_id=" +
                      encodeURIComponent(cntId) + "&file_id=" + encodeURIComponent(fid);
                    // Only add if not already added
                    if (imageUrls.indexOf(url) === -1) {
                      appendImage(msgEl, url);
                      imageUrls.push(url);
                    }
                  }
                }
              }
            }
          }
        }

        // Add save button
        appendSaveButton(msgEl, currentText, codeBlocks, imageUrls);

        // Update conversation history
        conversation.push({ role: "user", content: question });
        conversation.push({ role: "assistant", content: currentText });

        // Cap conversation at last 6 messages (3 exchanges)
        if (conversation.length > 6) {
          conversation = conversation.slice(-6);
        }
      }
    }

    function pump() {
      return reader.read().then(function (result) {
        if (result.done) return;

        buffer += decoder.decode(result.value, { stream: true });
        var lines = buffer.split("\n");
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (var i = 0; i < lines.length; i++) {
          processLine(lines[i]);
        }

        // Auto-scroll
        outputEl.scrollTop = outputEl.scrollHeight;

        return pump();
      });
    }

    return pump();
  }

  // ---------------------------------------------------------------------------
  // Output rendering helpers
  // ---------------------------------------------------------------------------
  function appendUserMessage(text) {
    var el = document.createElement("div");
    el.className = "output-message user-message";
    el.textContent = text;
    outputEl.appendChild(el);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  function renderText(container, text) {
    // Find or create text element
    var textEl = container.querySelector(".output-text");
    if (!textEl) {
      textEl = document.createElement("div");
      textEl.className = "output-text";
      container.appendChild(textEl);
    }
    // Render markdown
    if (typeof marked !== "undefined") {
      textEl.innerHTML = marked.parse(text);
    } else {
      textEl.textContent = text;
    }
  }

  function appendCodeBlock(container, code) {
    var details = document.createElement("details");
    details.className = "output-code";
    var summary = document.createElement("summary");
    summary.textContent = "Python code";
    details.appendChild(summary);
    var pre = document.createElement("pre");
    var codeEl = document.createElement("code");
    codeEl.textContent = code;
    pre.appendChild(codeEl);
    details.appendChild(pre);
    container.appendChild(details);
  }

  function appendImage(container, url) {
    var wrapper = document.createElement("div");
    wrapper.className = "output-image";
    var img = document.createElement("img");
    img.src = url;
    img.alt = "Analysis chart";
    img.loading = "lazy";
    img.onerror = function () {
      wrapper.innerHTML = '<p class="output-error">Chart failed to load</p>';
    };
    wrapper.appendChild(img);

    // Download button for the image
    var dl = document.createElement("a");
    dl.href = url;
    dl.download = "bellwether_chart.png";
    dl.className = "image-download";
    dl.textContent = "Download chart";
    wrapper.appendChild(dl);

    container.appendChild(wrapper);
  }

  function appendError(message) {
    var el = document.createElement("div");
    el.className = "output-message output-error";
    el.textContent = message;
    outputEl.appendChild(el);
  }

  // ---------------------------------------------------------------------------
  // Save to workspace
  // ---------------------------------------------------------------------------
  function appendSaveButton(container, text, codeBlocks, imageUrls) {
    var btn = document.createElement("button");
    btn.className = "save-btn";
    btn.textContent = "Save to workspace";
    btn.addEventListener("click", function () {
      var item = {
        id: Date.now().toString(36),
        timestamp: new Date().toISOString(),
        text: text,
        code: codeBlocks.join("\n\n"),
        images: imageUrls,
        title: text.split("\n")[0].replace(/^#+\s*/, "").slice(0, 80) || "Analysis",
      };
      saveToWorkspace(item);
      btn.textContent = "Saved";
      btn.disabled = true;
    });
    container.appendChild(btn);
  }

  function saveToWorkspace(item) {
    var workspace = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || "[]");
    workspace.push(item);
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
    renderWorkspace();
  }

  function renderWorkspace() {
    var panel = document.getElementById("workspacePanel");
    if (!panel) return;

    var workspace = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || "[]");
    var list = panel.querySelector(".workspace-list");
    if (!list) return;

    if (workspace.length === 0) {
      list.innerHTML = '<p class="workspace-empty">No saved items yet. Run an analysis and click "Save to workspace."</p>';
      return;
    }

    list.innerHTML = "";
    for (var i = 0; i < workspace.length; i++) {
      (function (item, idx) {
        var el = document.createElement("div");
        el.className = "workspace-item";
        var title = document.createElement("div");
        title.className = "workspace-item-title";
        title.textContent = item.title;
        el.appendChild(title);

        var meta = document.createElement("div");
        meta.className = "workspace-item-meta";
        meta.textContent = new Date(item.timestamp).toLocaleDateString();
        if (item.images && item.images.length) {
          meta.textContent += " · " + item.images.length + " chart(s)";
        }
        el.appendChild(meta);

        var actions = document.createElement("div");
        actions.className = "workspace-item-actions";

        // Delete button
        var del = document.createElement("button");
        del.textContent = "Remove";
        del.className = "workspace-delete";
        del.addEventListener("click", function (e) {
          e.stopPropagation();
          workspace.splice(idx, 1);
          localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
          renderWorkspace();
        });
        actions.appendChild(del);
        el.appendChild(actions);

        list.appendChild(el);
      })(workspace[i], i);
    }
  }

  // ---------------------------------------------------------------------------
  // Store password from auth gate
  // ---------------------------------------------------------------------------
  function storePassword(pw) {
    PASSWORD = pw;
    sessionStorage.setItem("sandboxPassword", pw);
  }

  // Expose for the password gate to call
  window.bellwetherSandbox = {
    init: init,
    storePassword: storePassword,
  };

  // Auto-init if DOM is ready and already authenticated
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if (sessionStorage.getItem("sandboxAuth") === "true") {
        init();
      }
    });
  } else {
    if (sessionStorage.getItem("sandboxAuth") === "true") {
      init();
    }
  }
})();
