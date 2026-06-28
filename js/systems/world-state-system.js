import { stateManager } from '../core/state-manager.js';
import { eventBus } from '../core/event-bus.js';

class WorldStateSystem {
  getWorldState() {
    return stateManager.get('world_state');
  }

  getCurrentLocation() {
    return stateManager.get('world_state.current_location') || '木叶隐村';
  }

  setLocation(location) {
    stateManager.update([
      { path: 'world_state.current_location', op: 'set', value: location }
    ]);
    eventBus.emit('world:location-changed', { location });
  }

  getCalendar() {
    const cal = stateManager.get('world_state.calendar');
    if (typeof cal === 'string' && cal.trim()) {
      return this._parseCalendarString(cal);
    }
    if (cal && typeof cal === 'object' && (cal.month || cal.season || cal.day)) {
      return this._validateCalendar(cal);
    }
    return { year: '木叶48年', month: 1, day: 1, time_of_day: '清晨' };
  }

  _parseCalendarString(str) {
    const result = { year: '木叶48年', month: 1, day: 1, time_of_day: '清晨' };
    const yearMatch = str.match(/木叶(\d+)年/);
    if (yearMatch) result.year = `木叶${yearMatch[1]}年`;
    const monthMatch = str.match(/(\d+)月/);
    if (monthMatch) result.month = parseInt(monthMatch[1]);
    const seasonMonthMap = { '春': 1, '夏': 4, '秋': 7, '冬': 10 };
    for (const [season, m] of Object.entries(seasonMonthMap)) {
      if (str.includes(season)) { result.month = m; break; }
    }
    const newDayMatch = str.match(/(\d+)日/);
    const oldDayMatch = str.match(/第(\d+)天/);
    if (newDayMatch) result.day = parseInt(newDayMatch[1]);
    else if (oldDayMatch) result.day = parseInt(oldDayMatch[1]);
    const timeOrder = ['清晨', '上午', '正午', '午后', '傍晚', '夜晚', '深夜'];
    for (const t of timeOrder) {
      if (str.includes(t)) { result.time_of_day = t; break; }
    }
    return result;
  }

  advanceTime(mode = 'scene') {
    const cal = this._validateCalendar(this.getCalendar());
    const timeOrder = ['清晨', '上午', '正午', '午后', '傍晚', '夜晚', '深夜'];

    const currentTimeIdx = timeOrder.indexOf(cal.time_of_day || '清晨');

    switch (mode) {
      case 'moment':
        cal.time_of_day = timeOrder[Math.min(currentTimeIdx + 1, timeOrder.length - 1)];
        break;
      case 'scene':
        cal.time_of_day = timeOrder[Math.min(currentTimeIdx + 2, timeOrder.length - 1)];
        if (currentTimeIdx >= timeOrder.length - 2) {
          cal.day = (cal.day || 1) + 1;
          cal.time_of_day = timeOrder[0];
          this._checkMonthChange(cal);
        }
        break;
      case 'day':
        cal.day = (cal.day || 1) + 1;
        cal.time_of_day = timeOrder[0];
        this._checkMonthChange(cal);
        break;
    }

    cal.day = Math.max(1, Math.min(31, Number(cal.day) || 1));

    stateManager.update([
      { path: 'world_state.calendar', op: 'set', value: cal }
    ]);
    stateManager.update([
      { path: 'world_state.month', op: 'set', value: cal.month }
    ]);
    eventBus.emit('world:time-advanced', { calendar: cal });
    return cal;
  }

  _validateCalendar(cal) {
    if (!cal || typeof cal !== 'object') {
      console.warn('[WorldState] Calendar is invalid, resetting to default');
      return { year: '木叶48年', month: 1, day: 1, time_of_day: '清晨' };
    }
    const seasonMonthMap = { '春': 1, '夏': 4, '秋': 7, '冬': 10 };
    return {
      year: cal.year || '木叶48年',
      month: (Number.isFinite(Number(cal.month))) ? Number(cal.month)
        : seasonMonthMap[cal.season] || 1,
      day: Number.isFinite(Number(cal.day)) && Number(cal.day) > 0 ? Number(cal.day) : 1,
      time_of_day: cal.time_of_day || '清晨'
    };
  }

  _checkMonthChange(cal) {
    const DAYS_PER_MONTH = 30;
    if (cal.day > DAYS_PER_MONTH) {
      cal.day = 1;
      if (cal.month < 12) {
        cal.month = cal.month + 1;
      } else {
        cal.month = 1;
        cal.year = this._incrementYear(cal.year);
      }
    }
  }

  _incrementYear(yearStr) {
    const match = yearStr.match(/木叶(\d+)年/);
    if (match) {
      return `木叶${parseInt(match[1]) + 1}年`;
    }
    return yearStr;
  }

  getWeather() {
    return stateManager.get('world_state.weather') || '晴';
  }

  setWeather(weather) {
    stateManager.update([
      { path: 'world_state.weather', op: 'set', value: weather }
    ]);
  }

  triggerEvent(eventData) {
    if (!eventData || typeof eventData !== 'object') {
      console.warn('[WorldState] Invalid event data:', typeof eventData);
      return null;
    }
    const now = Date.now();
    const id = eventData.id || eventData.title || eventData.name || `event_${now}`;
    const status = String(eventData.status || 'triggered').toLowerCase();
    const finalStatuses = new Set(['completed', 'resolved', 'ended', 'failed', 'cancelled']);
    const currentEvents = stateManager.get('world_state.active_events') || [];
    const events = currentEvents.filter(event => this._eventId(event) !== id);
    const entry = {
      ...eventData,
      id,
      status,
      description: eventData.description || eventData.detail || '',
      updated_at: now,
      triggered_at: eventData.triggered_at || now
    };

    if (!finalStatuses.has(status)) events.push(entry);

    const eventLog = stateManager.get('world_state.event_log') || [];
    stateManager.update([
      { path: 'world_state.active_events', op: 'set', value: events },
      { path: 'world_state.event_log', op: 'set', value: [...eventLog, entry].slice(-100) }
    ]);
    eventBus.emit('world:event-triggered', entry);
    return entry;
  }

  getActiveEvents() {
    return stateManager.get('world_state.active_events') || [];
  }

  getTimeline() {
    return stateManager.get('world_state.timeline') || '木叶48年';
  }
  _eventId(event) {
    if (event == null) return '';
    if (typeof event === 'string') return event;
    return event.id || event.title || event.name || event.description || '';
  }
}

export const worldStateSystem = new WorldStateSystem();
export default worldStateSystem;
