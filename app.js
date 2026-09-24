import { FilesetResolver, ObjectDetector } from "./vendor/vision_bundle.mjs";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const els = {
  video: $("#camera"),
  canvas: $("#overlay"),
  placeholder: $("#cameraPlaceholder"),
  cameraState: $("#cameraState"),
  cameraStateText: $("#cameraStateText"),
  start: $("#startBtn"),
  pause: $("#pauseBtn"),
  stop: $("#stopBtn"),
  timer: $("#timer"),
  phase: $("#phaseLabel"),
  activeTask: $("#activeTaskName"),
  alertBand: $("#alertBand"),
  alertKicker: $("#alertKicker"),
  alertTitle: $("#alertTitle"),
  alertCountdown: $("#alertCountdown"),
  falsePositive: $("#falsePositiveBtn"),
  calibrate: $("#calibrateBtn"),
  modelMetric: $("#modelMetric"),
  focusMetric: $("#focusMetric"),
  warningMetric: $("#warningMetric"),
  penaltyMetric: $("#penaltyMetric"),
  taskList: $("#taskList"),
  taskForm: $("#taskForm"),
  taskInput: $("#taskInput"),
  taskMinutes: $("#taskMinutes"),
  focusLength: $("#focusLength"),
  breakLength: $("#breakLength"),
  strictnessNote: $("#strictnessNote"),
  cameraModeNote: $("#cameraModeNote"),
  reminderStyleNote: $("#reminderStyleNote"),
  voiceToggle: $("#voiceToggle"),
  boxesToggle: $("#boxesToggle"),
  log: $("#eventLog"),
  autoPlan: $("#autoPlanBtn"),
  intervention: $("#intervention"),
  interventionLevel: $("#interventionLevel"),
  interventionTitle: $("#interventionTitle"),
  interventionText: $("#interventionText"),
  resume: $("#resumeBtn"),
  modalFalsePositive: $("#modalFalsePositiveBtn"),
};

const strictnessProfiles = {
  gentle: { phone: 8, away: 60, note: "手机持续 8 秒或离席 60 秒后提醒。" },
  standard: { phone: 5, away: 30, note: "手机持续 5 秒或离席 30 秒后提醒。" },
  strict: { phone: 3, away: 15, note: "手机持续 3 秒或离席 15 秒后提醒。" },
};

const state = {
  detector: null,
  stream: null,
  running: false,
  paused: false,
  phase: "focus",
  remainingSeconds: 50 * 60,
  focusSeconds: 0,
  penaltyMinutes: 0,
  warnings: 0,
  strictness: "standard",
  cameraMode: "computer",
  scenario: "exam",
  reminderStyle: "coach",
  issue: null,
  issueSince: 0,
  issueLevel: 0,
  ignoreUntil: 0,
  presenceOverrideUntil: 0,
  lastPersonSeenAt: 0,
  lastPhoneSeenAt: 0,
  studyReferences: [],
  referenceSimilarity: null,
  lastDetectionAt: 0,
  lastVideoTime: -1,
  lastTimerAt: 0,
  logs: [],
  tasks: loadTasks(),
};

function loadTasks() {
  try {
    const stored = JSON.parse(localStorage.getItem("study-monitor-tasks") || "null");
    if (Array.isArray(stored)) return stored;
  } catch (_) {}
  return [
    { id: crypto.randomUUID(), title: "完成一组目标院校真题", minutes: 45, done: false },
    { id: crypto.randomUUID(), title: "整理错题并写出失误原因", minutes: 25, done: false },
    { id: crypto.randomUUID(), title: "复习本轮核心知识点", minutes: 20, done: false },
  ];
}

function saveTasks() {
  localStorage.setItem("study-monitor-tasks", JSON.stringify(state.tasks));
}

function currentTask() {
  return state.tasks.find((task) => !task.done);
}

function renderTasks() {
  const active = currentTask();
  els.taskList.innerHTML = "";
  if (!state.tasks.length) {
    els.taskList.innerHTML = '<p class="empty-state">还没有任务。先添加一个 20-50 分钟可完成的小目标。</p>';
  }
  state.tasks.forEach((task) => {
    const row = document.createElement("div");
    row.className = `task-item${task.done ? " completed" : ""}${active?.id === task.id ? " current" : ""}`;
    row.innerHTML = `
      <input class="task-check" type="checkbox" ${task.done ? "checked" : ""} aria-label="完成 ${escapeHtml(task.title)}" />
      <div class="task-copy">
        <span class="task-title">${escapeHtml(task.title)}</span>
        <span class="task-meta">预计 ${task.minutes} 分钟${active?.id === task.id && state.running ? " · 进行中" : ""}</span>
      </div>
      <button class="remove-task" title="删除任务" aria-label="删除任务">×</button>`;
    row.querySelector(".task-check").addEventListener("change", (event) => {
      task.done = event.target.checked;
      saveTasks();
      renderTasks();
      updateActiveTask();
      addLog(task.done ? `完成任务：${task.title}` : `恢复任务：${task.title}`);
    });
    row.querySelector(".remove-task").addEventListener("click", () => {
      state.tasks = state.tasks.filter((item) => item.id !== task.id);
      saveTasks();
      renderTasks();
      updateActiveTask();
    });
    els.taskList.append(row);
  });
  updateActiveTask();
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function updateActiveTask() {
  const task = currentTask();
  els.activeTask.textContent = task ? task.title : "今天的任务已全部完成";
}

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function renderTimer() {
  els.timer.textContent = formatTime(state.remainingSeconds);
  els.focusMetric.textContent = `${Math.floor(state.focusSeconds / 60)} 分钟`;
  els.warningMetric.textContent = String(state.warnings);
  els.penaltyMetric.textContent = `${state.penaltyMinutes} 分钟`;
}

function setAlert(kind, kicker, title, countdown = "") {
  els.alertBand.className = `alert-band ${kind}`;
  els.alertKicker.textContent = kicker;
  els.alertTitle.textContent = title;
  els.alertCountdown.textContent = countdown;
}

function setCameraState(kind, text) {
  els.cameraState.className = `camera-state ${kind}`;
  els.cameraStateText.textContent = text;
}

function addLog(message) {
  const time = new Date();
  state.logs.unshift({ time: time.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }), message });
  state.logs = state.logs.slice(0, 50);
  els.log.innerHTML = state.logs.map((item) => `<div class="log-row"><time>${item.time}</time><span>${escapeHtml(item.message)}</span></div>`).join("");
}

function speak(message) {
  if (!els.voiceToggle.checked || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = "zh-CN";
  utterance.rate = 1.05;
  speechSynthesis.speak(utterance);
}

const scenarioPlans = {
  exam: {
    label: "考研",
    tasks: [
      ["主任务：完成一组真题并标出不确定题", 45],
      ["闭卷回忆：写出本组核心方法", 15],
      ["订正错题：记录错因和下一步", 15],
    ],
  },
  course: {
    label: "课程",
    tasks: [
      ["预习：列出本节 3 个关键问题", 20],
      ["学习：完成讲义或视频的核心部分", 35],
      ["自测：不看资料解释一个概念", 15],
    ],
  },
  project: {
    label: "项目",
    tasks: [
      ["拆解：写下本次交付的最小结果", 15],
      ["深度工作：完成一个可运行的小切片", 45],
      ["复盘：记录阻塞、证据和下一步", 15],
    ],
  },
  writing: {
    label: "论文",
    tasks: [
      ["检索：整理 3 篇相关文献的观点", 25],
      ["写作：完成一段可提交的初稿", 40],
      ["修改：标记论证缺口和待补证据", 15],
    ],
  },
};

const reminderStyles = {
  coach: { note: "短句提醒下一步行动，适合长时间学习。", voice: true },
  challenge: { note: "把纠偏变成一次 60 秒重启挑战，完成后继续。", voice: true },
  quiet: { note: "只显示轻量提示，不主动朗读。", voice: false },
};

function planForScenario() {
  const plan = scenarioPlans[state.scenario];
  const focusMinutes = Number(els.focusLength.value) || 50;
  const scale = focusMinutes / 75;
  state.tasks = plan.tasks.map(([title, minutes]) => ({
    id: crypto.randomUUID(),
    title,
    minutes: Math.max(10, Math.round(minutes * scale / 5) * 5),
    done: false,
  }));
  saveTasks();
  renderTasks();
  addLog(`生成${plan.label}场景任务`);
  setAlert("calm", `${plan.label}场景已准备`, "先完成当前任务的最小可交付结果");
}

async function initDetector() {
  if (state.detector) return;
  els.modelMetric.textContent = "加载中";
  const vision = await FilesetResolver.forVisionTasks("./vendor/wasm");
  state.detector = await ObjectDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: "./vendor/efficientdet_lite0.tflite", delegate: "GPU" },
    scoreThreshold: 0.18,
    maxResults: 8,
    runningMode: "VIDEO",
    categoryAllowlist: ["person", "cell phone", "book", "laptop"],
  });
  els.modelMetric.textContent = "已就绪";
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器不支持摄像头访问");
  state.stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  els.video.srcObject = state.stream;
  await els.video.play();
  els.placeholder.classList.add("hidden");
  resizeCanvas();
}

async function startSession() {
  els.start.disabled = true;
  els.start.textContent = "正在启动";
  setAlert("calm", "正在准备", "加载本地识别模型并连接摄像头");
  try {
    await Promise.all([initDetector(), startCamera()]);
    state.running = true;
    state.paused = false;
    state.phase = "focus";
    state.remainingSeconds = Number(els.focusLength.value) * 60 + state.penaltyMinutes * 60;
    state.lastTimerAt = performance.now();
    state.ignoreUntil = performance.now() + 8000;
    state.presenceOverrideUntil = 0;
    state.lastPersonSeenAt = 0;
    state.lastPhoneSeenAt = 0;
    els.phase.textContent = "专注阶段";
    els.start.textContent = "监督中";
    els.pause.disabled = false;
    els.stop.disabled = false;
    els.calibrate.classList.remove("hidden");
    setCameraState("idle", "识别中");
    setAlert("calm", "状态正常", "请开始当前任务");
    addLog(`开始 ${els.focusLength.value} 分钟专注`);
    renderTasks();
    requestAnimationFrame(loop);
  } catch (error) {
    console.error(error);
    els.start.disabled = false;
    els.start.textContent = "重试启动";
    els.modelMetric.textContent = "启动失败";
    setCameraState("alert", "无法启动");
    setAlert("alert", "启动失败", cameraErrorMessage(error));
  }
}

function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError") return "请允许浏览器使用摄像头后重试";
  if (error?.name === "NotFoundError") return "没有找到可用的摄像头";
  return `无法启动：${error?.message || "未知错误"}`;
}

function stopSession() {
  state.running = false;
  state.paused = false;
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  els.video.srcObject = null;
  els.placeholder.classList.remove("hidden");
  els.start.disabled = false;
  els.start.textContent = "开始新一轮";
  els.pause.disabled = true;
  els.pause.textContent = "Ⅱ";
  els.stop.disabled = true;
  els.calibrate.classList.add("hidden");
  els.calibrate.classList.remove("calibrated");
  els.calibrate.textContent = "以当前画面校准";
  state.studyReferences = [];
  state.referenceSimilarity = null;
  state.lastPhoneSeenAt = 0;
  els.phase.textContent = "本轮已结束";
  clearIssue();
  setCameraState("idle", "已停止");
  setAlert("calm", "已结束", `本轮累计有效专注 ${Math.floor(state.focusSeconds / 60)} 分钟`);
  addLog("手动结束本轮监督");
  renderTasks();
}

function togglePause() {
  if (!state.running) return;
  state.paused = !state.paused;
  state.lastTimerAt = performance.now();
  els.pause.textContent = state.paused ? "▶" : "Ⅱ";
  els.pause.title = state.paused ? "继续" : "暂停";
  els.phase.textContent = state.paused ? "已暂停" : (state.phase === "focus" ? "专注阶段" : "休息阶段");
  if (state.paused) {
    clearIssue();
    setAlert("warning", "计时暂停", "准备好后继续本轮专注");
    addLog("暂停监督");
  } else {
    state.ignoreUntil = performance.now() + 5000;
    setAlert("calm", "已继续", "重新进入专注状态");
    addLog("继续监督");
  }
}

function resizeCanvas() {
  const width = els.video.videoWidth || 1280;
  const height = els.video.videoHeight || 720;
  if (els.canvas.width !== width || els.canvas.height !== height) {
    els.canvas.width = width;
    els.canvas.height = height;
  }
}

const sampleCanvas = document.createElement("canvas");
sampleCanvas.width = 12;
sampleCanvas.height = 7;
const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });

function sampleCurrentFrame() {
  if (els.video.readyState < 2) return null;
  sampleContext.drawImage(els.video, 0, 0, sampleCanvas.width, sampleCanvas.height);
  const pixels = sampleContext.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
  const luminance = new Float32Array(sampleCanvas.width * sampleCanvas.height);
  for (let source = 0, target = 0; source < pixels.length; source += 4, target += 1) {
    luminance[target] = pixels[source] * 0.299 + pixels[source + 1] * 0.587 + pixels[source + 2] * 0.114;
  }
  return luminance;
}

function compareWithStudyReference() {
  if (!state.studyReferences.length) return null;
  const current = sampleCurrentFrame();
  if (!current) return null;
  return Math.max(...state.studyReferences.map((reference) => {
    let referenceMean = 0;
    let currentMean = 0;
    for (let index = 0; index < current.length; index += 1) {
      referenceMean += reference[index];
      currentMean += current[index];
    }
    referenceMean /= current.length;
    currentMean /= current.length;
    let rawDifference = 0;
    let structureDifference = 0;
    for (let index = 0; index < current.length; index += 1) {
      rawDifference += Math.abs(current[index] - reference[index]);
      structureDifference += Math.abs(
        (current[index] - currentMean) - (reference[index] - referenceMean),
      );
    }
    const difference = (rawDifference * 0.3 + structureDifference * 0.7) / current.length;
    return Math.max(0, 1 - difference / 75);
  }));
}

async function calibrateStudyFrame() {
  if (!sampleCurrentFrame()) {
    setAlert("warning", "暂时无法校准", "等待摄像头画面稳定后再试一次");
    return;
  }
  els.calibrate.disabled = true;
  els.calibrate.textContent = "校准中，请自然学习";
  setAlert("calm", "正在学习你的正常状态", "请保持学习，可自然写字或翻页");
  const references = [];
  for (let index = 0; index < 10; index += 1) {
    const sample = sampleCurrentFrame();
    if (sample) references.push(sample);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  state.studyReferences = references;
  state.referenceSimilarity = 1;
  state.presenceOverrideUntil = 0;
  state.lastPersonSeenAt = performance.now();
  els.calibrate.textContent = "已校准，可重新校准";
  els.calibrate.disabled = false;
  els.calibrate.classList.add("calibrated");
  setCameraState("calm", "已匹配学习基准");
  setAlert("calm", "学习基准已保存", "保持类似构图且未发现手机时，判定为学习中");
  addLog("以当前画面校准学习状态");
}

async function runDetection(now) {
  if (!state.detector || els.video.readyState < 2 || now - state.lastDetectionAt < 350) return;
  if (els.video.currentTime === state.lastVideoTime) return;
  state.lastDetectionAt = now;
  state.lastVideoTime = els.video.currentTime;
  const result = state.detector.detectForVideo(els.video, now);
  const detections = result.detections || [];
  drawDetections(detections);
  evaluateDetections(detections, now);
}

function drawDetections(detections) {
  resizeCanvas();
  const ctx = els.canvas.getContext("2d");
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  if (!els.boxesToggle.checked) return;
  detections.forEach((detection) => {
    const category = detection.categories?.[0];
    const box = detection.boundingBox;
    if (!category || !box) return;
    const isPhone = category.categoryName === "cell phone";
    ctx.strokeStyle = isPhone ? "#ff6b62" : "#5ee096";
    ctx.lineWidth = Math.max(3, els.canvas.width / 400);
    ctx.strokeRect(box.originX, box.originY, box.width, box.height);
    ctx.save();
    ctx.scale(-1, 1);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = `700 ${Math.max(15, els.canvas.width / 55)}px sans-serif`;
    const label = isPhone ? `疑似手机 ${Math.round(category.score * 100)}%` : `在座 ${Math.round(category.score * 100)}%`;
    ctx.fillText(label, -(box.originX + box.width), Math.max(22, box.originY - 7));
    ctx.restore();
  });
}

function evaluateDetections(detections, now) {
  if (!state.running || state.paused || state.phase !== "focus") return;
  const categories = detections.map((item) => item.categories?.[0]).filter(Boolean);
  const phoneDetected = categories.some((item) => item.categoryName === "cell phone" && item.score >= 0.16);
  if (phoneDetected) state.lastPhoneSeenAt = now;
  const phone = phoneDetected || (state.lastPhoneSeenAt > 0 && now - state.lastPhoneSeenAt < 2200);
  const laptop = categories.some((item) => item.categoryName === "laptop" && item.score >= 0.2);
  const personDetected = categories.some((item) => item.categoryName === "person" && item.score >= 0.2);
  if (personDetected) state.lastPersonSeenAt = now;
  state.referenceSimilarity = compareWithStudyReference();
  const referenceMatches = state.referenceSimilarity !== null && state.referenceSimilarity >= 0.55;
  const person = personDetected || referenceMatches || (state.lastPersonSeenAt > 0 && now - state.lastPersonSeenAt < 12000);
  const presenceOverridden = now < state.presenceOverrideUntil;

  if (now < state.ignoreUntil) {
    setCameraState("idle", "校准中");
    return;
  }
  if (phone) updateIssue("phone", now);
  else if (state.cameraMode === "computer" && !person && !presenceOverridden) updateIssue("away", now);
  else {
    if (state.issue) addLog(state.issue === "phone" ? "手机已移出画面" : "已回到座位");
    clearIssue();
    const similarityLabel = referenceMatches ? `匹配桌面学习状态 ${Math.round(state.referenceSimilarity * 100)}%` : null;
    const modeLabel = state.cameraMode === "desk"
      ? (similarityLabel || (laptop ? "检测到电脑画面，无法判断用途" : "桌面学习画面正常"))
      : (similarityLabel || (laptop ? "人在电脑前，需结合任务输出判断" : "专注条件正常"));
    setCameraState("calm", presenceOverridden ? "已手动确认在座" : modeLabel);
    setAlert(
      "calm",
      presenceOverridden ? "本轮已确认在座" : (state.cameraMode === "desk" ? "桌面模式：判定为学习中" : (referenceMatches ? "判定为学习中" : "状态正常")),
      state.cameraMode === "desk"
        ? (laptop ? "摄像头不能判断电脑上是在学习还是娱乐，请用任务结果自检" : "保持手部和桌面在画面内，继续当前任务")
        : (laptop ? "电脑用途无法由摄像头确认，完成当前任务后做一次自测" : "保持当前节奏，完成眼前这一小步"),
    );
  }
}

function updateIssue(type, now) {
  if (state.issue !== type) {
    state.issue = type;
    state.issueSince = now;
    state.issueLevel = 0;
    addLog(type === "phone" ? "检测到疑似手机" : "未检测到在座人员");
  }
  const elapsed = (now - state.issueSince) / 1000;
  const threshold = strictnessProfiles[state.strictness][type === "phone" ? "phone" : "away"];
  const left = Math.max(0, Math.ceil(threshold - elapsed));
  const title = type === "phone" ? "请把手机放到看不见、够不着的位置" : "请回到座位继续当前任务";
  setCameraState(elapsed >= threshold ? "alert" : "warning", type === "phone" ? "疑似使用手机" : "暂时离席");
  setAlert(elapsed >= threshold ? "alert" : "warning", type === "phone" ? "检测到手机" : "未检测到你", title, elapsed < threshold ? `${left} 秒后提醒` : "");
  els.falsePositive.classList.remove("hidden");

  if (elapsed >= threshold && state.issueLevel === 0) intervene(1, type);
  if (elapsed >= threshold + 15 && state.issueLevel === 1) intervene(2, type);
  if (elapsed >= threshold + 40 && state.issueLevel === 2) intervene(3, type);
}

function intervene(level, type) {
  state.issueLevel = level;
  state.warnings += 1;
  const additions = { 1: 0, 2: 2, 3: 5 };
  const added = additions[level];
  if (added) {
    state.penaltyMinutes += added;
    state.remainingSeconds += added * 60;
  }
  const action = type === "phone" ? "把手机放回视线外" : "回到座位继续当前任务";
  const styleMessage = state.reminderStyle === "challenge"
    ? "完成一次 60 秒重启：放下干扰，做出下一步动作。"
    : state.reminderStyle === "quiet"
      ? "已记录这次分心，请在方便时回到当前任务。"
      : "先做一个最小动作：放下干扰，继续当前任务。";
  els.interventionLevel.textContent = `第 ${level} 级纠偏`;
  els.interventionTitle.textContent = action;
  els.interventionText.textContent = added
    ? `${styleMessage}本轮增加 ${added} 分钟补偿专注时间。`
    : styleMessage;
  els.intervention.hidden = false;
  if (state.reminderStyle !== "quiet") speak(level === 1 ? `${action}。${styleMessage}` : `${action}。本轮增加${added}分钟补偿专注时间。`);
  addLog(`${level} 级纠偏${added ? `，增加 ${added} 分钟补偿` : ""}`);
  renderTimer();
}

function clearIssue() {
  state.issue = null;
  state.issueSince = 0;
  state.issueLevel = 0;
  els.falsePositive.classList.add("hidden");
  els.intervention.hidden = true;
}

function markFalsePositive() {
  const falseIssue = state.issue;
  if (falseIssue) addLog(`已标记误判：${falseIssue === "phone" ? "手机" : "离席"}`);
  if (falseIssue === "away") {
    state.presenceOverrideUntil = performance.now() + Math.max(60, state.remainingSeconds) * 1000;
  }
  state.ignoreUntil = performance.now() + 20000;
  clearIssue();
  setCameraState("calm", falseIssue === "away" ? "已手动确认在座" : "误判已忽略");
  setAlert(
    "calm",
    "已记录误判",
    falseIssue === "away" ? "本轮不再因人体漏检提醒，手机监督继续" : "20 秒内不会重复提醒",
  );
}

function tickTimer(now) {
  if (!state.running || state.paused) return;
  const delta = Math.min(1, (now - state.lastTimerAt) / 1000);
  state.lastTimerAt = now;
  state.remainingSeconds -= delta;
  if (state.phase === "focus" && !state.issue) state.focusSeconds += delta;
  if (state.remainingSeconds <= 0) switchPhase();
  renderTimer();
}

function switchPhase() {
  clearIssue();
  if (state.phase === "focus") {
    state.phase = "break";
    state.remainingSeconds = Number(els.breakLength.value) * 60;
    els.phase.textContent = "休息阶段";
    setAlert("calm", "专注完成", "起身喝水、远眺，休息时可以离席");
    setCameraState("idle", "休息中，不监督");
    speak("本轮专注完成。请起身休息。");
    addLog("完成专注，进入休息");
  } else {
    state.phase = "focus";
    state.remainingSeconds = Number(els.focusLength.value) * 60;
    state.ignoreUntil = performance.now() + 8000;
    state.presenceOverrideUntil = 0;
    state.lastPersonSeenAt = 0;
    els.phase.textContent = "专注阶段";
    setAlert("calm", "新一轮开始", "继续当前未完成任务");
    speak("休息结束，开始新一轮专注。");
    addLog("休息结束，开始新一轮专注");
  }
}

function loop(now) {
  if (!state.running) return;
  tickTimer(now);
  if (!state.paused) runDetection(now).catch((error) => {
    console.error(error);
    els.modelMetric.textContent = "识别异常";
  });
  requestAnimationFrame(loop);
}

function autoPlan() {
  planForScenario();
}

els.start.addEventListener("click", startSession);
els.pause.addEventListener("click", togglePause);
els.stop.addEventListener("click", stopSession);
els.falsePositive.addEventListener("click", markFalsePositive);
els.modalFalsePositive.addEventListener("click", markFalsePositive);
els.calibrate.addEventListener("click", calibrateStudyFrame);
els.resume.addEventListener("click", () => {
  els.intervention.hidden = true;
  state.ignoreUntil = performance.now() + 5000;
  addLog("确认已调整，继续学习");
});
els.autoPlan.addEventListener("click", autoPlan);
els.taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = els.taskInput.value.trim();
  if (!title) return;
  state.tasks.push({ id: crypto.randomUUID(), title, minutes: Number(els.taskMinutes.value) || 25, done: false });
  els.taskInput.value = "";
  saveTasks();
  renderTasks();
});
els.focusLength.addEventListener("change", () => {
  if (!state.running) {
    state.remainingSeconds = Number(els.focusLength.value) * 60;
    renderTimer();
  }
});

$$('.tab').forEach((tab) => tab.addEventListener("click", () => {
  $$('.tab').forEach((item) => { item.classList.toggle("active", item === tab); item.setAttribute("aria-selected", item === tab); });
  $$('.tab-panel').forEach((panel) => { panel.hidden = true; panel.classList.remove("active"); });
  const panel = $(`#${tab.dataset.tab}Panel`);
  panel.hidden = false;
  panel.classList.add("active");
}));

$$('[data-strictness]').forEach((button) => button.addEventListener("click", () => {
  state.strictness = button.dataset.strictness;
  $$('[data-strictness]').forEach((item) => item.classList.toggle("active", item === button));
  els.strictnessNote.textContent = strictnessProfiles[state.strictness].note;
}));

$$('[data-camera-mode]').forEach((button) => button.addEventListener("click", () => {
  state.cameraMode = button.dataset.cameraMode;
  $$('[data-camera-mode]').forEach((item) => item.classList.toggle("active", item === button));
  if (state.cameraMode === "desk") {
    els.cameraModeNote.textContent = "不因看不到脸而判定离席；重点观察桌面状态和疑似手机。";
    addLog("切换到手部 / 桌面模式");
    setAlert("calm", "桌面模式已启用", "不再因看不到完整的人而判定离席");
  } else {
    els.cameraModeNote.textContent = "重点判断你是否在座，以及是否疑似拿手机。";
    addLog("切换到电脑模式");
    setAlert("calm", "电脑模式已启用", "重点判断在座状态和疑似手机");
  }
}));

$$('[data-scenario]').forEach((button) => button.addEventListener("click", () => {
  state.scenario = button.dataset.scenario;
  $$('[data-scenario]').forEach((item) => item.classList.toggle("active", item === button));
  planForScenario();
}));

$$('[data-reminder-style]').forEach((button) => button.addEventListener("click", () => {
  state.reminderStyle = button.dataset.reminderStyle;
  $$('[data-reminder-style]').forEach((item) => item.classList.toggle("active", item === button));
  const profile = reminderStyles[state.reminderStyle];
  els.reminderStyleNote.textContent = profile.note;
  if (state.reminderStyle === "quiet") els.voiceToggle.checked = false;
  addLog(`提醒风格：${button.textContent}`);
}));

window.addEventListener("resize", resizeCanvas);
window.addEventListener("beforeunload", () => state.stream?.getTracks().forEach((track) => track.stop()));

renderTasks();
renderTimer();
