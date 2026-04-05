/* global cytoscape, THREE */
/* jshint esversion: 6 */

// =============================================
//  3D ENGINE VARIABLES  (declared at top)
// =============================================
var scene    = null;
var camera   = null;
var renderer = null;
var nodes3D  = {};
var isDragging = false;
var prevMouse  = { x: 0, y: 0 };

// =============================================
//  FA STATE VARIABLES
// =============================================
var states          = new Set();
var transitions     = {};
var startState      = null;
var acceptStates    = new Set();
var transitionCount = 0;

// =============================================
//  CYTOSCAPE INIT
// =============================================
var cy = cytoscape({
    container: document.getElementById("cy"),

    zoomingEnabled:     true,
    userZoomingEnabled: true,
    panningEnabled:     true,
    userPanningEnabled: true,
    minZoom: 0.3,
    maxZoom: 3,

    elements: [],

    style: [
        {
            selector: "node",
            style: {
                "background-color":   "#0e1a2e",
                "border-width":       2,
                "border-color":       "#1a3a6a",
                "label":              "data(id)",
                "color":              "#00d4ff",
                "font-size":          "14px",
                "font-family":        "Share Tech Mono, monospace",
                "font-weight":        "bold",
                "text-valign":        "center",
                "text-halign":        "center",
                "width":              65,
                "height":             65,
                "text-outline-width": 2,
                "text-outline-color": "#0e1a2e"
            }
        },
        {
            selector: ".start",
            style: {
                "background-color":   "#1a0e00",
                "border-color":       "#ffaa00",
                "border-width":       3,
                "color":              "#ffaa00",
                "text-outline-color": "#1a0e00"
            }
        },
        {
            selector: ".accept",
            style: {
                "border-width":       4,
                "border-color":       "#00ff9d",
                "color":              "#00ff9d",
                "text-outline-color": "#0e1a2e"
            }
        },
        {
            selector: ".start.accept",
            style: {
                "background-color": "#001a0e",
                "border-color":     "#00ff9d",
                "border-width":     5,
                "color":            "#00ff9d"
            }
        },
        {
            selector: ".active",
            style: {
                "background-color": "#2a0020",
                "border-color":     "#00d4ff",
                "border-width":     5,
                "color":            "#00d4ff"
            }
        },
        {
            selector: "edge",
            style: {
                "label":                   "data(label)",
                "color":                   "#4a6f9a",
                "font-size":               "12px",
                "font-family":             "Share Tech Mono, monospace",
                "target-arrow-shape":      "triangle",
                "target-arrow-color":      "#1a3a6a",
                "line-color":              "#1a3a6a",
                "curve-style":             "bezier",
                "control-point-step-size": 40,
                "text-background-color":   "#050a13",
                "text-background-opacity": 1,
                "text-background-padding": "3px"
            }
        },
        {
            selector: "edge.active-edge",
            style: {
                "line-color":         "#00d4ff",
                "target-arrow-color": "#00d4ff",
                "color":              "#00d4ff",
                "width":              2.5
            }
        }
    ]
});

// =============================================
//  LAYOUT — fit:true fixes corner-placement bug
// =============================================
function refreshLayout() {
    cy.layout({
        name:                        "circle",
        padding:                     80,
        animate:                     true,
        animationDuration:           300,
        fit:                         true,
        avoidOverlap:                true,
        nodeDimensionsIncludeLabels: true
    }).run();
}

// =============================================
//  UI HELPERS
// =============================================
function updateInfo() {
    document.getElementById("infoStates").textContent = states.size;
    document.getElementById("infoStart").textContent  = startState || "—";
    document.getElementById("infoAccept").textContent =
        acceptStates.size > 0 ? Array.from(acceptStates).join(", ") : "—";
    document.getElementById("infoTrans").textContent = transitionCount;

    var tagList = document.getElementById("tagList");
    tagList.innerHTML = "";

    states.forEach(function(s) {
        var tag = document.createElement("span");
        tag.className   = "tag";
        tag.textContent = s;
        var isStart  = (s === startState);
        var isAccept = acceptStates.has(s);
        if (isStart && isAccept) {
            tag.classList.add("both");
        } else if (isStart) {
            tag.classList.add("start");
        } else if (isAccept) {
            tag.classList.add("accept");
        }
        tagList.appendChild(tag);
    });
}

function logStep(text, type, num) {
    var stepType = type || "active-step";
    var stepNum  = (num !== undefined && num !== null) ? num : "";

    var log   = document.getElementById("stepLog");
    var empty = log.querySelector(".empty-log");
    if (empty) {
        empty.remove();
    }

    var entry = document.createElement("div");
    entry.className = "step-entry " + stepType;
    entry.innerHTML =
        "<span class=\"step-num\">" + stepNum + "</span>" +
        "<span class=\"step-text\">" + text + "</span>";

    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

function clearLog() {
    document.getElementById("stepLog").innerHTML =
        "<div class=\"empty-log\">Running simulation...</div>";
}

function showStatus(msg, type) {
    var el = document.getElementById("statusDisplay");
    el.textContent = msg;
    el.className   = "status-display show " + type;
}

function hideStatus() {
    document.getElementById("statusDisplay").className = "status-display";
}

function flashInput(id) {
    var el = document.getElementById(id);
    el.style.borderColor = "#ff3a5c";
    setTimeout(function() {
        el.style.borderColor = "";
    }, 600);
}

function wait(ms) {
    return new Promise(function(resolve) {
        setTimeout(resolve, ms);
    });
}

// =============================================
//  ADD STATE
// =============================================
function addState() {
    var s = document.getElementById("state").value.trim();
    if (!s) { return; }
    if (states.has(s)) { flashInput("state"); return; }

    states.add(s);
    cy.add({ group: "nodes", data: { id: s } });
    addState3D(s);
    refreshLayout();
    updateInfo();
    logStep("State <span>" + s + "</span> added.", "active-step", ">>>");
}

// =============================================
//  ADD TRANSITION
// =============================================
function addTransition() {
    var f   = document.getElementById("from").value.trim();
    var t   = document.getElementById("to").value.trim();
    var sym = document.getElementById("symbol").value.trim();

    if (!states.has(f) || !states.has(t) || !sym) { return; }

    if (!transitions[f]) {
        transitions[f] = {};
    }
    if (!transitions[f][sym]) {
        transitions[f][sym] = [];
    }

    transitions[f][sym].push(t);
    transitionCount++;

    cy.add({
        group: "edges",
        data: {
            id:     f + "_" + t + "_" + sym + "_" + Math.random(),
            source: f,
            target: t,
            label:  sym
        }
    });

    addEdge3D(f, t);
    refreshLayout();
    updateInfo();
    logStep(
        "Transition <span>" + f + "</span> [<span>" + sym + "</span>] to <span>" + t + "</span> added.",
        "active-step",
        ">>>"
    );
}

// =============================================
//  SET START STATE
// =============================================
function setStartState() {
    var s = document.getElementById("state").value.trim();
    if (!states.has(s)) { flashInput("state"); return; }

    startState = s;
    cy.nodes().removeClass("start");
    cy.getElementById(s).addClass("start");
    updateInfo();
    logStep("<span>" + s + "</span> set as START state.", "active-step", ">>>");
}

// =============================================
//  SET ACCEPT STATE
// =============================================
function setAcceptState() {
    var s = document.getElementById("state").value.trim();
    if (!states.has(s)) { flashInput("state"); return; }

    acceptStates.add(s);
    cy.getElementById(s).addClass("accept");
    updateInfo();

    if (nodes3D[s]) {
        nodes3D[s].material.color.setHex(0x00ff9d);
    }

    logStep("<span>" + s + "</span> set as ACCEPT state.", "accepted", "OK");
}

// =============================================
//  SIMULATE
// =============================================
async function simulate() {
    var input = document.getElementById("inputString").value;

    if (!startState) {
        showStatus("No start state defined", "rejected");
        return;
    }

    hideStatus();
    clearLog();
    cy.nodes().removeClass("active");
    cy.edges().removeClass("active-edge");

    logStep("Input: <span>\"" + (input || "empty") + "\"</span>", "active-step", ">>>");
    logStep("Start: <span>" + startState + "</span>", "active-step", "");
    await wait(200);

    var curr = [startState];
    highlight(curr);
    await wait(500);

    var step = 1;
    var i, j, ch, s, fromStates, next;

    for (i = 0; i < input.length; i++) {
        ch         = input[i];
        fromStates = curr.slice();
        next       = [];

        for (j = 0; j < curr.length; j++) {
            s = curr[j];
            if (transitions[s] && transitions[s][ch]) {
                next = next.concat(transitions[s][ch]);

                (function(currentS, currentCh) {
                    cy.edges().forEach(function(e) {
                        if (
                            e.data("source") === currentS &&
                            transitions[currentS][currentCh].indexOf(e.data("target")) !== -1 &&
                            e.data("label") === currentCh
                        ) {
                            e.addClass("active-edge");
                        }
                    });
                }(s, ch));
            }
        }

        var fromStr = fromStates.map(function(st) {
            return "<span>" + st + "</span>";
        }).join(", ");

        var toStr = next.length > 0
            ? next.map(function(st) { return "<span>" + st + "</span>"; }).join(", ")
            : "<span style=\"color:#ff3a5c\">dead end</span>";

        logStep(
            "Step " + step + ": " + fromStr + " + [<span>" + ch + "</span>] = " + toStr,
            "active-step",
            step
        );

        highlight(next);
        await wait(700);

        cy.edges().removeClass("active-edge");
        curr = next;
        step++;

        if (curr.length === 0) { break; }
    }

    var accepted = curr.some(function(st) {
        return acceptStates.has(st);
    });

    var finalStr = curr.length > 0
        ? curr.map(function(st) { return "<span>" + st + "</span>"; }).join(", ")
        : "<span style=\"color:#ff3a5c\">none</span>";

    logStep("Final state(s): " + finalStr, accepted ? "accepted" : "rejected", "END");

    if (accepted) {
        logStep("Result: <span style=\"color:#00ff9d\">STRING ACCEPTED</span>", "accepted", "");
        showStatus("ACCEPTED", "accepted");
    } else {
        logStep("Result: <span style=\"color:#ff3a5c\">STRING REJECTED</span>", "rejected", "");
        showStatus("REJECTED", "rejected");
    }
}

// =============================================
//  HIGHLIGHT  (2D + 3D sync)
// =============================================
function highlight(arr) {
    cy.nodes().removeClass("active");
    arr.forEach(function(s) {
        cy.getElementById(s).addClass("active");
    });

    Object.keys(nodes3D).forEach(function(s) {
        var m = nodes3D[s].material;
        if (arr.indexOf(s) !== -1) {
            m.color.setHex(0xff3a5c);
            if (m.emissive) { m.emissive.setHex(0x660000); }
        } else {
            var isAccept = acceptStates.has(s);
            var isStart  = (s === startState);
            if (isAccept) {
                m.color.setHex(0x00ff9d);
            } else if (isStart) {
                m.color.setHex(0xffaa00);
            } else {
                m.color.setHex(0x0074d9);
            }
            if (m.emissive) { m.emissive.setHex(0x001133); }
        }
    });
}

// =============================================
//  RESET
// =============================================
function resetGraph() {
    cy.elements().remove();
    states.clear();
    transitions     = {};
    acceptStates    = new Set();
    startState      = null;
    transitionCount = 0;

    while (scene.children.length > 0) {
        scene.remove(scene.children[0]);
    }
    nodes3D = {};

    scene.add(new THREE.AmbientLight(0x334466, 1.2));

    var dLight = new THREE.DirectionalLight(0x00d4ff, 0.8);
    dLight.position.set(5, 5, 5);
    scene.add(dLight);

    addStarfield();
    updateInfo();
    hideStatus();

    document.getElementById("stepLog").innerHTML =
        "<div class=\"empty-log\">No simulation run yet</div>";
}

// =============================================
//  THREE.JS  —  3D ENGINE
// =============================================
function init3D() {
    var c = document.getElementById("threeContainer");

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020610);
    scene.fog = new THREE.Fog(0x020610, 15, 40);

    camera = new THREE.PerspectiveCamera(60, c.clientWidth / c.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 12);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(c.clientWidth, c.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    c.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x334466, 1.2));

    var dLight = new THREE.DirectionalLight(0x00d4ff, 0.8);
    dLight.position.set(5, 5, 5);
    scene.add(dLight);

    var dLight2 = new THREE.DirectionalLight(0x7b2fff, 0.4);
    dLight2.position.set(-5, -3, -5);
    scene.add(dLight2);

    addStarfield();

    var canvas = renderer.domElement;

    canvas.addEventListener("mousedown", function(e) {
        isDragging = true;
        prevMouse  = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener("mouseup", function() {
        isDragging = false;
    });

    window.addEventListener("mousemove", function(e) {
        if (!isDragging) { return; }
        var dx = e.clientX - prevMouse.x;
        var dy = e.clientY - prevMouse.y;
        scene.rotation.y += dx * 0.008;
        scene.rotation.x += dy * 0.008;
        prevMouse = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener("resize", function() {
        camera.aspect = c.clientWidth / c.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(c.clientWidth, c.clientHeight);
    });

    animate3D();
}

function animate3D() {
    requestAnimationFrame(animate3D);
    if (!isDragging) { scene.rotation.y += 0.004; }
    renderer.render(scene, camera);
}

function addStarfield() {
    var geo   = new THREE.BufferGeometry();
    var count = 300;
    var pos   = new Float32Array(count * 3);
    var k;
    for (k = 0; k < count * 3; k++) {
        pos[k] = (Math.random() - 0.5) * 60;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({ color: 0x334466, size: 0.08 });
    scene.add(new THREE.Points(geo, mat));
}

function addState3D(s) {
    var count  = Object.keys(nodes3D).length;
    var angle  = (count / Math.max(states.size, 1)) * Math.PI * 2;
    var radius = Math.max(2.5, states.size * 0.8);

    var geo = new THREE.SphereGeometry(0.55, 32, 32);
    var mat = new THREE.MeshPhongMaterial({
        color:     0x0074d9,
        emissive:  0x001133,
        shininess: 80,
        specular:  0x00d4ff
    });

    var sphere = new THREE.Mesh(geo, mat);
    sphere.position.set(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        (Math.random() - 0.5) * 2
    );

    var ringGeo = new THREE.TorusGeometry(0.68, 0.04, 8, 40);
    var ringMat = new THREE.MeshBasicMaterial({ color: 0x1a3a6a });
    sphere.add(new THREE.Mesh(ringGeo, ringMat));

    scene.add(sphere);
    nodes3D[s] = sphere;
}

function addEdge3D(a, b) {
    if (!nodes3D[a] || !nodes3D[b]) { return; }
    var points = [nodes3D[a].position.clone(), nodes3D[b].position.clone()];
    var geo    = new THREE.BufferGeometry().setFromPoints(points);
    var mat    = new THREE.LineBasicMaterial({ color: 0x1a3a6a });
    scene.add(new THREE.Line(geo, mat));
}

// =============================================
//  KEYBOARD SHORTCUTS
// =============================================
document.addEventListener("keydown", function(e) {
    if (e.key !== "Enter") { return; }
    var id = document.activeElement.id;
    if (id === "state")                 { addState(); }
    if (id === "symbol" || id === "to") { addTransition(); }
    if (id === "inputString")           { simulate(); }
});

// =============================================
//  INIT
// =============================================
window.onload = function() {
    init3D();
    updateInfo();
};