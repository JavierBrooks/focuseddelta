// Step: Restriction System (Rewards + Penalties Enforcement)

import { useState, useEffect, useCallback } from "react";


// ---------- Helpers ----------
function getToday() {
  const d = new Date();
  return d.toLocaleDateString("en-CA");
}

function toDate(dateStr) {
  const [year, month, day] = dateStr.split("-");
  return new Date(year, month - 1, day);
}

function getLast7Days() {
  const days = [];
  const today = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);

    days.push({
      label: d.toLocaleDateString("en-US", { weekday: "short" }),
      date: d.toLocaleDateString("en-CA")
    });
  }

  return days;
}
const isPeriodComplete = (goal) => {
  const now = toDate(getToday());

  if (goal.period === "daily") return true;

  if (goal.period === "weekly") {
    return now.getDay() === 0; // Sunday = end of week
  }

  if (goal.period === "monthly") {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    return tomorrow.getDate() === 1; // last day of month
  }

  return false;
};

function isDateInGoalWindow(goal, dateStr) {
  if (goal.startDate && dateStr < goal.startDate) return false;
  if (goal.endDate && dateStr > goal.endDate) return false;
  return true;
}

function getProgress(goal) {
  const now = toDate(getToday());

  return goal.logs.filter(log => {
    if (!isDateInGoalWindow(goal, log.date)) return false;

    const d = toDate(log.date);

    if (goal.period === "daily") return log.date === getToday();

    if (goal.period === "weekly") {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay());

      const end = new Date(start);
      end.setDate(start.getDate() + 6);

      return d >= start && d <= end;
    }

    if (goal.period === "monthly") {
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }

    return false;
  }).length;
}

function getStreak(goal) {
  const sortedLogs = [...goal.logs]
    .filter(log => isDateInGoalWindow(goal, log.date))
    .map(log => toDate(log.date))
    .sort((a, b) => b - a);

  let streak = 0;
  let currentDate = toDate(getToday());

  for (let i = 0; i < sortedLogs.length; i++) {
    const logDate = sortedLogs[i];

    if (logDate.getTime() === currentDate.getTime()) {
      streak++;
      currentDate.setDate(currentDate.getDate() - 1);
    } else break;
  }

  return streak;
}

/** When a period boundary hits today, stamp lastEvaluated and count new penalties. Immutable: returns prevGoals ref if nothing changed. */
function applyPeriodEndEvaluation(prevGoals) {
  const today = getToday();
  let penaltyDelta = 0;

  const next = prevGoals.map(goal => {
    if (!isPeriodComplete(goal)) return goal;
    if (goal.lastEvaluated === today) return goal;

    const progress = getProgress(goal);
    if (progress < goal.target) penaltyDelta += 1;

    return { ...goal, lastEvaluated: today };
  });

  const changed = next.some((g, i) => g !== prevGoals[i]);

  return {
    nextGoals: changed ? next : prevGoals,
    penaltyDelta: changed ? penaltyDelta : 0,
    changed,
  };
}

function getMonthDays(date) {
  const year = date.getFullYear();
  const month = date.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const days = [];

  // fill empty slots before month starts
  for (let i = 0; i < firstDay.getDay(); i++) {
    days.push(null);
  }

  // actual days
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const fullDate = new Date(year, month, d);
    days.push({
      date: fullDate.toLocaleDateString("en-CA"),
      day: d
    });
  }

  return days;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function clampTimeHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return "09:00";
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function timeStringToMinutes(s) {
  const t = clampTimeHHMM(s);
  const [h, min] = t.split(":").map(Number);
  return h * 60 + min;
}

/** Geo distance in meters (WGS84 spherical approximation). */
function haversineDistanceM(from, to) {
  const R = 6371000;
  const rad = x => (x * Math.PI) / 180;
  const dLat = rad(to.lat - from.lat);
  const dLng = rad(to.lng - from.lng);
  const la1 = rad(from.lat);
  const la2 = rad(to.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function getCurrentPositionAsync() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not supported in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, err => {
      reject(new Error(err.message || "Could not read location (permission or GPS)."));
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });
}

function isNowInTimeCondition(cond, now) {
  if (!cond?.days?.length) return true;
  const dow = now.getDay();
  if (!cond.days.includes(dow)) return false;

  const mins = now.getHours() * 60 + now.getMinutes();
  const start = timeStringToMinutes(cond.start);
  const end = timeStringToMinutes(cond.end);

  if (start <= end) return mins >= start && mins <= end;
  return mins >= start || mins <= end;
}

function formatTimeCondHuman(time) {
  if (!time?.days?.length) return "";
  const days = time.days.map(d => WEEKDAY_SHORT[d] ?? d).join(", ");
  return `on ${days}, ${clampTimeHHMM(time.start)}–${clampTimeHHMM(time.end)} local time`;
}

/** Validate time + geofence at “tap now” for today’s check-in. */
async function validateCheckInConditions(goal) {
  const { time, geofence } = goal.conditions ?? { time: null, geofence: null };
  const reasons = [];

  if (time?.days?.length) {
    const now = new Date();
    if (!isNowInTimeCondition(time, now)) {
      reasons.push(
        `Allowed times: ${formatTimeCondHuman(time)}. Not in that window right now.`
      );
    }
  }

  if (geofence) {
    try {
      const pos = await getCurrentPositionAsync();
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const dist = haversineDistanceM(here, { lat: geofence.lat, lng: geofence.lng });
      if (dist > geofence.radiusM) {
        reasons.push(
          `You are about ${Math.round(dist)} m from the allowed spot (must be within ${geofence.radiusM} m).`
        );
      }
    } catch (e) {
      reasons.push(e.message || "Location is required for this goal but could not be read.");
    }
  }

  if (reasons.length === 0) return { ok: true };
  return { ok: false, reason: reasons.join(" ") };
}

function normalizeConditions(c) {
  if (!c || typeof c !== "object") return { time: null, geofence: null };

  let geofence = null;
  if (c.geofence && typeof c.geofence === "object") {
    const lat = Number(c.geofence.lat);
    const lng = Number(c.geofence.lng);
    const radiusM = Number(c.geofence.radiusM);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180 &&
      Number.isFinite(radiusM) &&
      radiusM > 0
    ) {
      geofence = { lat, lng, radiusM };
    }
  }

  let time = null;
  if (c.time && typeof c.time === "object" && Array.isArray(c.time.days) && c.time.days.length > 0) {
    const days = [
      ...new Set(
        c.time.days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
      ),
    ].sort((a, b) => a - b);
    if (days.length > 0) {
      time = {
        days,
        start: clampTimeHHMM(c.time.start),
        end: clampTimeHHMM(c.time.end),
      };
    }
  }

  return { time, geofence };
}

function normalizeGoal(g) {
  const period = g.period === "weekly" || g.period === "monthly" ? g.period : "daily";
  const target = Number(g.target);
  const dateOk = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

  return {
    id: g.id,
    name: String(g.name ?? ""),
    target: Number.isFinite(target) && target > 0 ? target : 1,
    period,
    reward: String(g.reward ?? ""),
    punishment: String(g.punishment ?? ""),
    logs: Array.isArray(g.logs) ? g.logs : [],
    lastEvaluated: g.lastEvaluated ?? null,
    specificDescription: String(g.specificDescription ?? ""),
    unit: String(g.unit ?? ""),
    achievableNote: String(g.achievableNote ?? ""),
    realisticNote: String(g.realisticNote ?? ""),
    startDate: dateOk(g.startDate) ? g.startDate : null,
    endDate: dateOk(g.endDate) ? g.endDate : null,
    conditions: normalizeConditions(g.conditions),
  };
}

function migrateGoals(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeGoal);
}

function getEmptyForm() {
  return {
    name: "",
    specificDescription: "",
    target: 1,
    unit: "",
    period: "daily",
    achievableNote: "",
    realisticNote: "",
    startDate: "",
    endDate: "",
    reward: "",
    punishment: "",
    conditionsTimeEnabled: false,
    conditionsTimeDays: [1, 2, 3, 4, 5],
    conditionsTimeStart: "06:00",
    conditionsTimeEnd: "22:00",
    conditionsGeofenceEnabled: false,
    conditionsGeofenceRadiusM: 100,
    conditionsGeofenceLat: "",
    conditionsGeofenceLng: "",
  };
}

function goalToForm(goal) {
  const c = goal.conditions ?? { time: null, geofence: null };
  const time = c.time;
  const geo = c.geofence;
  return {
    name: goal.name ?? "",
    specificDescription: goal.specificDescription ?? "",
    target: goal.target ?? 1,
    unit: goal.unit ?? "",
    period: goal.period ?? "daily",
    achievableNote: goal.achievableNote ?? "",
    realisticNote: goal.realisticNote ?? "",
    startDate: goal.startDate ?? "",
    endDate: goal.endDate ?? "",
    reward: goal.reward ?? "",
    punishment: goal.punishment ?? "",
    conditionsTimeEnabled: Boolean(time?.days?.length > 0),
    conditionsTimeDays:
      time?.days?.length > 0 ? [...time.days] : [1, 2, 3, 4, 5],
    conditionsTimeStart: time?.start ?? "06:00",
    conditionsTimeEnd: time?.end ?? "22:00",
    conditionsGeofenceEnabled: Boolean(geo),
    conditionsGeofenceRadiusM: geo?.radiusM ?? 100,
    conditionsGeofenceLat: geo ? String(geo.lat) : "",
    conditionsGeofenceLng: geo ? String(geo.lng) : "",
  };
}

function buildConditionsPayload(form) {
  return normalizeConditions({
    time:
      form.conditionsTimeEnabled && form.conditionsTimeDays.length > 0
        ? {
            days: form.conditionsTimeDays,
            start: form.conditionsTimeStart,
            end: form.conditionsTimeEnd,
          }
        : null,
    geofence:
      form.conditionsGeofenceEnabled &&
      form.conditionsGeofenceLat?.trim() &&
      form.conditionsGeofenceLng?.trim()
        ? {
            lat: Number(form.conditionsGeofenceLat),
            lng: Number(form.conditionsGeofenceLng),
            radiusM: Math.max(
              10,
              Number(form.conditionsGeofenceRadiusM) || 100
            ),
          }
        : null,
  });
}

function validateGoalConditionsForm(form) {
  if (form.conditionsTimeEnabled && form.conditionsTimeDays.length === 0) {
    window.alert(
      "Pick at least one day for time check-ins, or turn off time rules."
    );
    return false;
  }
  if (
    form.conditionsGeofenceEnabled &&
    (!form.conditionsGeofenceLat?.trim() ||
      !form.conditionsGeofenceLng?.trim())
  ) {
    window.alert(
      'Use "Save current location" while at the allowed place, or turn off location check-in.'
    );
    return false;
  }
  return true;
}

// ---------- Theme ----------
const THEMES = {
  light: {
    pageBg: "#f5f5f5",
    text: "#1a1a1a",
    textMuted: "#5f6368",
    cardBg: "#ffffff",
    cardShadow: "0 4px 10px rgba(0,0,0,0.1)",
    border: "#ccc",
    inputBg: "#ffffff",
    inputBorder: "#ccc",
    progressTrack: "#ddd",
    progressFill: "#4CAF50",
    statusSuccess: "#2e7d32",
    statusFail: "#c62828",
    rewardOk: "#2e7d32",
    rewardBad: "#c62828",
    calDone: "#2e7d32",
    calTodo: "#eee",
    calTodoText: "#1a1a1a",
    monthDayTodo: "#f0f0f0",
    monthDayTodoText: "#1a1a1a",
    warningBg: "#fff3cd",
    warningText: "#856404",
    warningBorder: "#ffc107",
    primary: "#c62828",
    primaryText: "#ffffff",
    navBtnBg: "#e8eaed",
    navBtnText: "#1a1a1a",
    navBtnBorder: "#dadce0",
  },
  dark: {
    pageBg: "#121212",
    text: "#e8eaed",
    textMuted: "#9aa0a6",
    cardBg: "#1e1e1e",
    cardShadow: "0 4px 20px rgba(0,0,0,0.5)",
    border: "#3c4043",
    inputBg: "#2d2d30",
    inputBorder: "#5f6368",
    progressTrack: "#3c4043",
    progressFill: "#66bb6a",
    statusSuccess: "#81c784",
    statusFail: "#ef9a9a",
    rewardOk: "#81c784",
    rewardBad: "#ef9a9a",
    calDone: "#388e3c",
    calTodo: "#2d2d30",
    calTodoText: "#e8eaed",
    monthDayTodo: "#2d2d30",
    monthDayTodoText: "#e8eaed",
    warningBg: "#3d3500",
    warningText: "#fdd663",
    warningBorder: "#f9ab00",
    primary: "#e53935",
    primaryText: "#ffffff",
    navBtnBg: "#3c4043",
    navBtnText: "#e8eaed",
    navBtnBorder: "#5f6368",
  },
};

const inputStyle = (t) => ({
  padding: "8px 10px",
  borderRadius: 8,
  border: `1px solid ${t.inputBorder}`,
  background: t.inputBg,
  color: t.text,
  outline: "none",
});

const textAreaStyle = (t) => ({
  ...inputStyle(t),
  width: "100%",
  minHeight: 72,
  resize: "vertical",
  boxSizing: "border-box",
  fontFamily: "inherit",
});

function smartSectionLabel(t, letter, title) {
  return (
    <div
      style={{
        width: "100%",
        flexBasis: "100%",
        marginTop: 12,
        marginBottom: 4,
        fontSize: "0.8rem",
        fontWeight: 700,
        color: t.textMuted,
        letterSpacing: "0.02em",
      }}
    >
      {letter} — {title}
    </div>
  );
}

// ---------- Components ----------

function GoalForm({
  form,
  setForm,
  handleChange,
  onSaveGoal,
  editingGoalId,
  onCancelEdit,
  t,
}) {
  const [smartOpen, setSmartOpen] = useState(true);
  const [locLoading, setLocLoading] = useState(false);
  const isEditing = editingGoalId != null;

  const toggleCondDay = (d) => {
    setForm(prev => {
      const has = prev.conditionsTimeDays.includes(d);
      const conditionsTimeDays = has
        ? prev.conditionsTimeDays.filter(x => x !== d)
        : [...prev.conditionsTimeDays, d].sort((a, b) => a - b);
      return { ...prev, conditionsTimeDays };
    });
  };

  const captureLocation = async () => {
    setLocLoading(true);
    try {
      const pos = await getCurrentPositionAsync();
      setForm(prev => ({
        ...prev,
        conditionsGeofenceEnabled: true,
        conditionsGeofenceLat: String(pos.coords.latitude),
        conditionsGeofenceLng: String(pos.coords.longitude),
      }));
    } catch (e) {
      window.alert(e.message ?? "Could not capture location.");
    } finally {
      setLocLoading(false);
    }
  };

  const clearGeofence = () => {
    setForm(prev => ({
      ...prev,
      conditionsGeofenceEnabled: false,
      conditionsGeofenceLat: "",
      conditionsGeofenceLng: "",
    }));
  };

  return (
    <div className="goal-form-grid" style={{ marginBottom: 20 }}>
      {isEditing ? (
        <div
          style={{
            width: "100%",
            flexBasis: "100%",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${t.warningBorder}`,
            background: t.warningBg,
            color: t.warningText,
            fontSize: "0.9rem",
          }}
        >
          <span>
            Editing goal — press <strong>Save changes</strong> to apply, or{" "}
            <strong>Cancel</strong> to discard.
          </span>
          <button
            type="button"
            onClick={onCancelEdit}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: `1px solid ${t.border}`,
              background: t.cardBg,
              color: t.text,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}

      <input
        name="name"
        placeholder="Goal title"
        value={form.name}
        onChange={handleChange}
        className="goal-input goal-input--grow"
        style={{ ...inputStyle(t), flexBasis: "100%", width: "100%" }}
      />

      {smartSectionLabel(t, "M", "Measurable")}
      <input
        name="target"
        type="number"
        min={1}
        value={form.target}
        onChange={handleChange}
        className="goal-input goal-input--narrow"
        style={inputStyle(t)}
      />
      <input
        name="unit"
        placeholder="Unit (e.g. workouts, minutes, pages)"
        value={form.unit}
        onChange={handleChange}
        className="goal-input goal-input--grow"
        style={inputStyle(t)}
      />

      <select
        name="period"
        value={form.period}
        onChange={handleChange}
        className="goal-input goal-input--grow"
        style={{ ...inputStyle(t), cursor: "pointer" }}
      >
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </select>

      <div style={{ width: "100%", flexBasis: "100%", marginTop: 4 }}>
        <button
          type="button"
          id="goal-form-smart-toggle"
          aria-expanded={smartOpen}
          aria-controls="goal-form-smart-panel"
          onClick={() => setSmartOpen(o => !o)}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${t.border}`,
            background: t.cardBg,
            color: t.text,
            cursor: "pointer",
            fontWeight: 600,
            textAlign: "left",
            display: "flex",
            alignItems: "center",
            gap: 8,
            boxSizing: "border-box",
          }}
        >
          <span aria-hidden style={{ fontSize: "0.7rem", width: "1em" }}>
            {smartOpen ? "▼" : "▶"}
          </span>
          <span>
            SMART details{" "}
            <span style={{ fontWeight: 400, color: t.textMuted }}>
              (Specific, Achievable, Realistic, Time-bound)
            </span>
          </span>
        </button>
      </div>

      {smartOpen ? (
        <div
          id="goal-form-smart-panel"
          role="region"
          aria-labelledby="goal-form-smart-toggle"
          style={{
            display: "contents",
          }}
        >
          {smartSectionLabel(t, "S", "Specific")}
          <textarea
            name="specificDescription"
            placeholder="What exactly will you do? (behavior, context, when…)"
            value={form.specificDescription}
            onChange={handleChange}
            className="goal-input goal-input--grow"
            rows={3}
            style={textAreaStyle(t)}
          />

          {smartSectionLabel(t, "C", "Check-in conditions")}
          <p
            style={{
              width: "100%",
              flexBasis: "100%",
              margin: "0 0 8px",
              fontSize: "0.85rem",
              color: t.textMuted,
              lineHeight: 1.4,
            }}
          >
            Rules apply when you mark <strong style={{ color: t.text }}>today</strong> on the calendar.
            Past dates are not blocked (backfill). Location needs HTTPS and browser permission.
          </p>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              flexBasis: "100%",
              cursor: "pointer",
              color: t.text,
            }}
          >
            <input
              type="checkbox"
              name="conditionsTimeEnabled"
              checked={form.conditionsTimeEnabled}
              onChange={handleChange}
            />
            Require check-in during certain times (local clock)
          </label>

          {form.conditionsTimeEnabled ? (
            <>
              <div
                style={{
                  width: "100%",
                  flexBasis: "100%",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  alignItems: "center",
                }}
              >
                {WEEKDAY_SHORT.map((label, d) => {
                  const on = form.conditionsTimeDays.includes(d);
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => toggleCondDay(d)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: `1px solid ${t.border}`,
                        background: on ? t.progressFill : t.navBtnBg,
                        color: on ? "#fff" : t.navBtnText,
                        cursor: "pointer",
                        fontWeight: 600,
                        fontSize: "0.8rem",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <input
                name="conditionsTimeStart"
                type="time"
                value={form.conditionsTimeStart}
                onChange={handleChange}
                className="goal-input goal-input--grow"
                style={{ ...inputStyle(t), colorScheme: "inherit" }}
              />
              <input
                name="conditionsTimeEnd"
                type="time"
                value={form.conditionsTimeEnd}
                onChange={handleChange}
                className="goal-input goal-input--grow"
                style={{ ...inputStyle(t), colorScheme: "inherit" }}
              />
            </>
          ) : null}

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              flexBasis: "100%",
              cursor: "pointer",
              color: t.text,
              marginTop: form.conditionsTimeEnabled ? 4 : 0,
            }}
          >
            <input
              type="checkbox"
              name="conditionsGeofenceEnabled"
              checked={form.conditionsGeofenceEnabled}
              onChange={handleChange}
            />
            Require check-in near a saved GPS spot
          </label>

          {form.conditionsGeofenceEnabled ? (
            <>
              <input
                name="conditionsGeofenceRadiusM"
                type="number"
                min={10}
                step={10}
                placeholder="Radius (meters)"
                value={form.conditionsGeofenceRadiusM}
                onChange={handleChange}
                className="goal-input goal-input--grow"
                style={inputStyle(t)}
              />
              <div
                style={{
                  width: "100%",
                  flexBasis: "100%",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <button
                  type="button"
                  disabled={locLoading}
                  onClick={() => void captureLocation()}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: `1px solid ${t.border}`,
                    background: t.navBtnBg,
                    color: t.navBtnText,
                    cursor: locLoading ? "wait" : "pointer",
                    fontWeight: 600,
                  }}
                >
                  {locLoading ? "Getting location…" : "Save current location"}
                </button>
                <button
                  type="button"
                  onClick={clearGeofence}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: `1px solid ${t.border}`,
                    background: "transparent",
                    color: t.statusFail,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Clear location
                </button>
              </div>
              {form.conditionsGeofenceLat && form.conditionsGeofenceLng ? (
                <p
                  style={{
                    width: "100%",
                    flexBasis: "100%",
                    margin: 0,
                    fontSize: "0.8rem",
                    color: t.textMuted,
                  }}
                >
                  Saved:{" "}
                  {Number(form.conditionsGeofenceLat).toFixed(5)},{" "}
                  {Number(form.conditionsGeofenceLng).toFixed(5)}
                </p>
              ) : (
                <p
                  style={{
                    width: "100%",
                    flexBasis: "100%",
                    margin: 0,
                    fontSize: "0.8rem",
                    color: t.warningText,
                  }}
                >
                  Tap &quot;Save current location&quot; while you’re at the allowed place (e.g. gym).
                </p>
              )}
            </>
          ) : null}

          {smartSectionLabel(t, "A", "Achievable")}
          <textarea
            name="achievableNote"
            placeholder="Why is this target realistic for you right now? (optional)"
            value={form.achievableNote}
            onChange={handleChange}
            className="goal-input goal-input--grow"
            rows={2}
            style={textAreaStyle(t)}
          />

          {smartSectionLabel(t, "R", "Realistic")}
          <textarea
            name="realisticNote"
            placeholder="Constraints, tradeoffs, backup plan (optional)"
            value={form.realisticNote}
            onChange={handleChange}
            className="goal-input goal-input--grow"
            rows={2}
            style={textAreaStyle(t)}
          />

          {smartSectionLabel(t, "T", "Time-bound")}
          <input
            name="startDate"
            type="date"
            value={form.startDate}
            onChange={handleChange}
            className="goal-input goal-input--grow"
            style={{ ...inputStyle(t), colorScheme: "inherit" }}
          />
          <input
            name="endDate"
            type="date"
            value={form.endDate}
            min={form.startDate || undefined}
            onChange={handleChange}
            className="goal-input goal-input--grow"
            style={{ ...inputStyle(t), colorScheme: "inherit" }}
          />
        </div>
      ) : null}

      <div
        style={{
          width: "100%",
          flexBasis: "100%",
          marginTop: 12,
          marginBottom: 4,
          fontSize: "0.8rem",
          fontWeight: 700,
          color: t.textMuted,
        }}
      >
        Rewards & accountability
      </div>
      <input
        name="reward"
        placeholder="Reward"
        value={form.reward}
        onChange={handleChange}
        className="goal-input goal-input--grow"
        style={inputStyle(t)}
      />
      <input
        name="punishment"
        placeholder="Punishment"
        value={form.punishment}
        onChange={handleChange}
        className="goal-input goal-input--grow"
        style={inputStyle(t)}
      />

      <button
        type="button"
        className="cta-btn"
        style={{
          padding: "10px 14px",
          borderRadius: "8px",
          border: "none",
          background: t.primary,
          color: t.primaryText,
          cursor: "pointer",
          fontWeight: 600,
        }}
        onClick={onSaveGoal}
      >
        {isEditing ? "Save changes" : "Add goal"}
      </button>
    </div>
  );
}

function Calendar({ goal, toggleDate, t }) {
  const days = getLast7Days();

  return (
    <div className="cal-week-grid">
      {days.map(day => {
        const isDone = goal.logs.some(log => log.date === day.date);
        const inWindow = isDateInGoalWindow(goal, day.date);

        return (
          <div
            key={day.date}
            className="cal-week-day"
            onClick={() => inWindow && void toggleDate(goal, day.date)}
            style={{
              cursor: inWindow ? "pointer" : "not-allowed",
              opacity: inWindow ? 1 : 0.45,
              border: `1px solid ${t.border}`,
              background: isDone ? t.calDone : t.calTodo,
              color: isDone ? "#ffffff" : t.calTodoText,
              borderRadius: 8,
            }}
            title={inWindow ? undefined : "Outside goal date range"}
          >
            <div>{day.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function RestrictionStatus({ goal, isUnlocked, t }) {
  return (
    <div style={{ marginTop: 10 }}>
      {isUnlocked ? (
        <p style={{ color: t.rewardOk }}>✅ Reward Unlocked: {goal.reward}</p>
      ) : (
        <p style={{ color: t.rewardBad }}>⛔ Restricted: {goal.reward}</p>
      )}
    </div>
  );
}

function GoalCard({
  goal,
  getProgress,
  getStatus,
  toggleDate,
  onEditGoal,
  onDeleteGoal,
  isRewardUnlocked,
  currentMonth,
  setCurrentMonth,
  t,
}) {
  const progress = getProgress(goal);
  const status = getStatus(goal);
  const unitLabel = goal.unit?.trim() || "check-ins";
  const hasSmartDetails =
    goal.specificDescription?.trim() ||
    goal.achievableNote?.trim() ||
    goal.realisticNote?.trim() ||
    goal.startDate ||
    goal.endDate;

  return (
    <div
      className="goal-card"
      style={{
        background: t.cardBg,
        borderRadius: "12px",
        marginBottom: "15px",
        boxShadow: t.cardShadow,
        border: `1px solid ${t.border}`,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <h3 style={{ margin: 0, color: t.text, flex: 1, minWidth: 0 }}>{goal.name}</h3>
        <div style={{ display: "flex", flexShrink: 0, gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => onEditGoal(goal)}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: `1px solid ${t.border}`,
              background: t.navBtnBg,
              color: t.navBtnText,
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "0.85rem",
            }}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  `Remove goal “${goal.name}”? This cannot be undone.`
                )
              ) {
                onDeleteGoal(goal.id);
              }
            }}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: `1px solid ${t.statusFail}`,
              background: "transparent",
              color: t.statusFail,
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "0.85rem",
            }}
          >
            Remove
          </button>
        </div>
      </div>
      {goal.specificDescription?.trim() ? (
        <p style={{ margin: "4px 0 12px", color: t.textMuted, fontSize: "0.95rem" }}>
          {goal.specificDescription.trim()}
        </p>
      ) : null}
      {(goal.conditions?.time || goal.conditions?.geofence) ? (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${t.warningBorder}`,
            background: t.warningBg,
            color: t.warningText,
            fontSize: "0.88rem",
          }}
        >
          <strong style={{ display: "block", marginBottom: 6 }}>
            Check-in rules (when marking today)
          </strong>
          {goal.conditions?.time?.days?.length ? (
            <p style={{ margin: "0 0 6px" }}>
              Time: {formatTimeCondHuman(goal.conditions.time)}
            </p>
          ) : null}
          {goal.conditions?.geofence ? (
            <p style={{ margin: 0 }}>
              Place: within {goal.conditions.geofence.radiusM} m of your saved
              coordinates.
            </p>
          ) : null}
        </div>
      ) : null}
      {(goal.startDate || goal.endDate) ? (
        <p style={{ margin: "4px 0", color: t.textMuted, fontSize: "0.9rem" }}>
          {goal.startDate ? `From ${goal.startDate}` : ""}
          {goal.startDate && goal.endDate ? " · " : ""}
          {goal.endDate ? `Until ${goal.endDate}` : ""}
        </p>
      ) : null}
      {hasSmartDetails && (goal.achievableNote?.trim() || goal.realisticNote?.trim()) ? (
        <div
          style={{
            marginTop: 10,
            marginBottom: 8,
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${t.border}`,
            background: t.pageBg,
            fontSize: "0.88rem",
            color: t.textMuted,
          }}
        >
          {goal.achievableNote?.trim() ? (
            <p style={{ margin: "0 0 8px" }}>
              <strong style={{ color: t.text }}>Achievable:</strong> {goal.achievableNote.trim()}
            </p>
          ) : null}
          {goal.realisticNote?.trim() ? (
            <p style={{ margin: 0 }}>
              <strong style={{ color: t.text }}>Realistic:</strong> {goal.realisticNote.trim()}
            </p>
          ) : null}
        </div>
      ) : null}
      <p style={{ margin: "4px 0", color: t.textMuted }}>Type: {goal.period}</p>
      <p style={{ margin: "4px 0", color: t.textMuted }}>🔥 Streak: {getStreak(goal)} days</p>
      <p style={{ margin: "4px 0", color: t.text }}>
        Progress: {progress} / {goal.target} <span style={{ color: t.textMuted }}>{unitLabel}</span> (this period)
      </p>

      <div
        style={{
          height: "8px",
          background: t.progressTrack,
          borderRadius: "5px",
          overflow: "hidden",
          marginTop: "5px",
        }}
      >
        <div
          style={{
            width: `${(progress / goal.target) * 100}%`,
            background: t.progressFill,
            height: "100%",
          }}
        />
      </div>

      <p
        style={{
          color: status.type === "success" ? t.statusSuccess : t.statusFail,
          fontWeight: "bold",
        }}
      >
        {status.message}
      </p>

      <RestrictionStatus goal={goal} isUnlocked={isRewardUnlocked(goal)} t={t} />

      <Calendar goal={goal} toggleDate={toggleDate} t={t} />
      <MonthlyCalendar
        goal={goal}
        toggleDate={toggleDate}
        currentMonth={currentMonth}
        setCurrentMonth={setCurrentMonth}
        t={t}
      />
    </div>
  );
}

function MonthlyCalendar({ goal, toggleDate, currentMonth, setCurrentMonth, t }) {
  const days = getMonthDays(currentMonth);

  const navBtn = {
    padding: "6px 12px",
    borderRadius: 8,
    border: `1px solid ${t.navBtnBorder}`,
    background: t.navBtnBg,
    color: t.navBtnText,
    cursor: "pointer",
  };

  return (
    <div style={{ marginTop: 15 }}>
      <div className="month-nav">
        <button
          type="button"
          style={navBtn}
          onClick={() => {
            const prev = new Date(currentMonth);
            prev.setMonth(prev.getMonth() - 1);
            setCurrentMonth(prev);
          }}
        >
          ◀
        </button>

        <strong className="month-nav__title" style={{ color: t.text }}>
          {currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </strong>

        <button
          type="button"
          style={navBtn}
          onClick={() => {
            const next = new Date(currentMonth);
            next.setMonth(next.getMonth() + 1);
            setCurrentMonth(next);
          }}
        >
          ▶
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          marginTop: "10px",
          fontWeight: "bold",
          color: t.textMuted,
        }}
      >
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
          <div key={d} style={{ textAlign: "center" }}>
            {d}
          </div>
        ))}
      </div>

      <div className="month-grid">
        {days.map((day, index) => {
          if (!day) return <div key={index}></div>;

          const isDone = goal.logs.some(log => log.date === day.date);
          const inWindow = isDateInGoalWindow(goal, day.date);

          return (
            <div
              key={day.date}
              role={inWindow ? "button" : undefined}
              tabIndex={inWindow ? 0 : undefined}
              className="month-day-cell"
              onClick={() => inWindow && void toggleDate(goal, day.date)}
              onKeyDown={(e) => {
                if (!inWindow) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void toggleDate(goal, day.date);
                }
              }}
              onMouseEnter={(e) => inWindow && (e.currentTarget.style.transform = "scale(1.05)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
              style={{
                textAlign: "center",
                cursor: inWindow ? "pointer" : "not-allowed",
                opacity: inWindow ? 1 : 0.45,
                border: `1px solid ${t.border}`,
                background: isDone ? t.calDone : t.monthDayTodo,
                borderRadius: "8px",
                transition: "0.2s",
                color: isDone ? "#ffffff" : t.monthDayTodoText,
              }}
              title={inWindow ? undefined : "Outside goal date range"}
            >
              {day.day}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Main App ----------

export default function App() {
  const [goals, setGoals] = useState(() => {
    try {
      const raw = localStorage.getItem("goals");
      if (!raw) return [];
      return migrateGoals(JSON.parse(raw));
    } catch {
      return [];
    }
  });

  const [form, setForm] = useState(getEmptyForm);

  const [editingGoalId, setEditingGoalId] = useState(null);

  const [currentMonth, setCurrentMonth] = useState(new Date());

  const [penalties, setPenalties] = useState(0);

  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("focusedapp-theme") === "dark");

  const t = darkMode ? THEMES.dark : THEMES.light;

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const cancelEdit = useCallback(() => {
    setEditingGoalId(null);
    setForm(getEmptyForm());
  }, []);

  const startEditGoal = useCallback((goal) => {
    setEditingGoalId(goal.id);
    setForm(goalToForm(goal));
  }, []);

  const saveGoal = () => {
    if (!form.name) return;
    if (!validateGoalConditionsForm(form)) return;

    const conditions = buildConditionsPayload(form);

    if (editingGoalId != null) {
      setGoals(prev =>
        prev.map(g =>
          g.id !== editingGoalId
            ? g
            : normalizeGoal({
                ...g,
                name: form.name,
                specificDescription: form.specificDescription,
                target: Number(form.target),
                unit: form.unit,
                period: form.period,
                achievableNote: form.achievableNote,
                realisticNote: form.realisticNote,
                startDate: form.startDate.trim() || null,
                endDate: form.endDate.trim() || null,
                reward: form.reward,
                punishment: form.punishment,
                conditions,
              })
        )
      );
      setEditingGoalId(null);
      setForm(getEmptyForm());
      return;
    }

    const goal = normalizeGoal({
      id: Date.now(),
      name: form.name,
      specificDescription: form.specificDescription,
      target: Number(form.target),
      unit: form.unit,
      period: form.period,
      achievableNote: form.achievableNote,
      realisticNote: form.realisticNote,
      startDate: form.startDate.trim() || null,
      endDate: form.endDate.trim() || null,
      reward: form.reward,
      punishment: form.punishment,
      logs: [],
      lastEvaluated: null,
      conditions,
    });

    setGoals(prev => [...prev, goal]);
    setForm(getEmptyForm());
  };

  const toggleDate = useCallback(async (goal, date) => {
    const goalId = goal.id;
    if (!isDateInGoalWindow(goal, date)) return;

    const exists = goal.logs.some(log => log.date === date);
    if (exists) {
      setGoals(prevGoals =>
        prevGoals.map(g => {
          if (g.id !== goalId) return g;
          return { ...g, logs: g.logs.filter(log => log.date !== date) };
        })
      );
      return;
    }

    const isToday = date === getToday();
    const c = goal.conditions;
    const hasRules = Boolean(
      (c?.time?.days?.length > 0) || c?.geofence
    );

    if (isToday && hasRules) {
      const v = await validateCheckInConditions(goal);
      if (!v.ok) {
        const override = window.confirm(
          `${v.reason}\n\nCheck in anyway? (honor-system override)`
        );
        if (!override) return;
      }
    }

    setGoals(prevGoals =>
      prevGoals.map(g => {
        if (g.id !== goalId) return g;
        return { ...g, logs: [...g.logs, { date }] };
      })
    );
  }, []);

  const deleteGoal = useCallback((goalId) => {
    setGoals(prev => prev.filter(g => g.id !== goalId));
    setEditingGoalId(eid => {
      if (eid === goalId) {
        queueMicrotask(() => setForm(getEmptyForm()));
        return null;
      }
      return eid;
    });
  }, []);

  const getStatus = (goal) => {
    const progress = getProgress(goal);

    if (progress >= goal.target) {
      return { type: "success", message: `Reward unlocked: ${goal.reward}` };
    }

    return { type: "fail", message: `If you fail: ${goal.punishment}` };
  };

  const isRewardUnlocked = (goal) => {
    return getProgress(goal) >= goal.target;
  };

  // Read latest goals via functional setGoals; do not close over stale `goals` from render.
  const checkPenalties = useCallback(() => {
    setGoals(prev => {
      const underTarget = prev.reduce(
        (n, goal) => n + (getProgress(goal) < goal.target ? 1 : 0),
        0
      );
      queueMicrotask(() => {
        setPenalties(underTarget);
      });
      return prev;
    });
  }, []);

  useEffect(() => {
    localStorage.setItem("goals", JSON.stringify(goals));
  }, [goals]);

  useEffect(() => {
    localStorage.setItem("focusedapp-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  // Period-end evaluation: derive updates from the latest goals via functional setState only.
  // When nothing changes, the same goals reference is returned so React skips an extra render.
  // Penalties are bumped in a microtask so we never call setPenalties synchronously inside the updater.
  /* eslint-disable react-hooks/set-state-in-effect -- intentional sync when goals commit (incl. storage rehydrate) */
  useEffect(() => {
    setGoals(prev => {
      const { nextGoals, penaltyDelta, changed } = applyPeriodEndEvaluation(prev);

      if (changed && penaltyDelta > 0) {
        queueMicrotask(() => {
          setPenalties(p => p + penaltyDelta);
        });
      }

      return nextGoals;
    });
  }, [goals]);
  /* eslint-enable react-hooks/set-state-in-effect */

const allowedEntertainment = Math.max(0, 10 - penalties * 2);

/*Main App Return */
  return (
    <div
      className="app-shell"
      style={{
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        background: t.pageBg,
        color: t.text,
        minHeight: "100dvh",
        colorScheme: darkMode ? "dark" : "light",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <h1 className="app-title" style={{ margin: 0, color: t.text, flex: "1 1 12rem", minWidth: 0 }}>
          Goal Tracker + Restrictions
        </h1>
        <button
          type="button"
          onClick={() => setDarkMode(v => !v)}
          aria-pressed={darkMode}
          aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: `1px solid ${t.border}`,
            background: t.cardBg,
            color: t.text,
            cursor: "pointer",
            fontWeight: 600,
            boxShadow: t.cardShadow,
            flexShrink: 0,
          }}
        >
          {darkMode ? "☀️ Light" : "🌙 Dark"}
        </button>
      </header>

      <GoalForm
        form={form}
        setForm={setForm}
        handleChange={handleChange}
        onSaveGoal={saveGoal}
        editingGoalId={editingGoalId}
        onCancelEdit={cancelEdit}
        t={t}
      />

      <div
        style={{
          background: t.warningBg,
          color: t.warningText,
          padding: "12px 14px",
          borderRadius: "8px",
          marginBottom: "12px",
          border: `1px solid ${t.warningBorder}`,
        }}
      >
        <p style={{ margin: "0 0 6px" }}>⚠️ Penalties: {penalties}</p>
        <p style={{ margin: 0 }}>🎮 Allowed entertainment: {allowedEntertainment} hrs</p>
      </div>

      <button
        type="button"
        className="cta-btn"
        style={{
          padding: "10px 14px",
          borderRadius: "8px",
          border: "none",
          background: t.primary,
          color: t.primaryText,
          cursor: "pointer",
          fontWeight: 600,
          marginBottom: 16,
        }}
        onClick={checkPenalties}
      >
        Run Weekly Check
      </button>

      {goals.map(goal => (
        <GoalCard
          key={goal.id}
          goal={goal}
          getProgress={getProgress}
          getStatus={getStatus}
          toggleDate={toggleDate}
          onEditGoal={startEditGoal}
          onDeleteGoal={deleteGoal}
          isRewardUnlocked={isRewardUnlocked}
          currentMonth={currentMonth}
          setCurrentMonth={setCurrentMonth}
          t={t}
        />
      ))}
    </div>
  );
}
