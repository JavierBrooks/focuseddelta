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

function getProgress(goal) {
  const now = toDate(getToday());

  return goal.logs.filter(log => {
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

// ---------- Components ----------

function GoalForm({ form, handleChange, addGoal, t }) {
  return (
    <div className="goal-form-grid" style={{ marginBottom: 20 }}>
      <input
        name="name"
        placeholder="Goal name"
        value={form.name}
        onChange={handleChange}
        className="goal-input goal-input--grow"
        style={inputStyle(t)}
      />
      <input
        name="target"
        type="number"
        value={form.target}
        onChange={handleChange}
        className="goal-input goal-input--narrow"
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
        onClick={addGoal}
      >
        Add Goal
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

        return (
          <div
            key={day.date}
            className="cal-week-day"
            onClick={() => toggleDate(goal.id, day.date)}
            style={{
              cursor: "pointer",
              border: `1px solid ${t.border}`,
              background: isDone ? t.calDone : t.calTodo,
              color: isDone ? "#ffffff" : t.calTodoText,
              borderRadius: 8,
            }}
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
  getStreak,
  toggleDate,
  isRewardUnlocked,
  currentMonth,
  setCurrentMonth,
  t,
}) {
  const progress = getProgress(goal);
  const status = getStatus(goal);

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
      <h3 style={{ margin: "0 0 8px", color: t.text }}>{goal.name}</h3>
      <p style={{ margin: "4px 0", color: t.textMuted }}>Type: {goal.period}</p>
      <p style={{ margin: "4px 0", color: t.textMuted }}>🔥 Streak: {getStreak(goal)} days</p>
      <p style={{ margin: "4px 0", color: t.text }}>Progress: {progress} / {goal.target}</p>

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

          return (
            <div
              key={day.date}
              role="button"
              tabIndex={0}
              className="month-day-cell"
              onClick={() => toggleDate(goal.id, day.date)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleDate(goal.id, day.date);
                }
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
              style={{
                textAlign: "center",
                cursor: "pointer",
                border: `1px solid ${t.border}`,
                background: isDone ? t.calDone : t.monthDayTodo,
                borderRadius: "8px",
                transition: "0.2s",
                color: isDone ? "#ffffff" : t.monthDayTodoText,
              }}
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
    const saved = localStorage.getItem("goals");
    return saved ? JSON.parse(saved) : [];
  });

  const [form, setForm] = useState({
    name: "",
    target: 1,
    period: "daily",
    reward: "",
    punishment: ""
  });

  const [currentMonth, setCurrentMonth] = useState(new Date());

  const [penalties, setPenalties] = useState(0);

  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("focusedapp-theme") === "dark");

  const t = darkMode ? THEMES.dark : THEMES.light;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
  };

  const addGoal = () => {
    if (!form.name) return;

    const goal = {
      id: Date.now(),
      name: form.name,
      target: Number(form.target),
      period: form.period,
      reward: form.reward,
      punishment: form.punishment,
      logs: [],
      lastEvaluated: null
    };

    setGoals(prev => [...prev, goal]);

    setForm({ name: "", target: 1, period: "daily", reward: "", punishment: "" });
  };

  const toggleDate = (goalId, date) => {
    setGoals(prevGoals =>
      prevGoals.map(goal => {
        if (goal.id !== goalId) return goal;

        const exists = goal.logs.some(log => log.date === date);

        const updatedLogs = exists
          ? goal.logs.filter(log => log.date !== date)
          : [...goal.logs, { date }];

        return { ...goal, logs: updatedLogs };
      })
    );
  };

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

  const getStreak = (goal) => {
    const sortedLogs = [...goal.logs]
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

      <GoalForm form={form} handleChange={handleChange} addGoal={addGoal} t={t} />

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
          getStreak={getStreak}
          toggleDate={toggleDate}
          isRewardUnlocked={isRewardUnlocked}
          currentMonth={currentMonth}
          setCurrentMonth={setCurrentMonth}
          t={t}
        />
      ))}
    </div>
  );
}
