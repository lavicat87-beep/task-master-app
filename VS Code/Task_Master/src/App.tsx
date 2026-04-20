import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

type TaskStatus = 'todo' | 'in-progress' | 'done';
type TaskPriority = 'low' | 'medium' | 'high';
type TaskFilter = 'all' | TaskStatus;
type TaskView = 'board' | 'reminders';
type NotificationPermissionState = NotificationPermission | 'unsupported';
type MessageTone = 'success' | 'error' | 'neutral';
type EditableTaskFields = Pick<
  Task,
  'title' | 'notes' | 'priority' | 'category' | 'dueDate' | 'reminderAt'
>;

type Task = {
  id: string;
  title: string;
  notes: string;
  priority: TaskPriority;
  status: TaskStatus;
  category: string;
  dueDate: string;
  reminderAt: string;
  createdAt: string;
  statusOrder: number;
  notifiedReminderAt: string;
};

type ExportPayload = {
  version: number;
  exportedAt: string;
  tasks: Task[];
};

type TaskCardOptions = {
  showBoardControls: boolean;
  showReminderActions: boolean;
  position: number;
  total: number;
};

const STORAGE_KEY = 'task-master.tasks';
const boardStatuses: TaskStatus[] = ['todo', 'in-progress', 'done'];
const defaultSnoozeMinutes = 15;

function toLocalDateTimeInput(date: Date): string {
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

const sampleTasks: Task[] = [
  {
    id: crypto.randomUUID(),
    title: 'Outline this week\'s goals',
    notes: 'Break the big objective into three concrete deliverables.',
    priority: 'high',
    status: 'in-progress',
    category: 'Planning',
    dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString().slice(0, 10),
    reminderAt: toLocalDateTimeInput(new Date(Date.now() + 1000 * 60 * 60 * 6)),
    createdAt: new Date().toISOString(),
    statusOrder: 0,
    notifiedReminderAt: '',
  },
  {
    id: crypto.randomUUID(),
    title: 'Clear low-value backlog',
    notes: 'Archive or delete stale tasks to keep the list sharp.',
    priority: 'medium',
    status: 'todo',
    category: 'Ops',
    dueDate: '',
    reminderAt: '',
    createdAt: new Date().toISOString(),
    statusOrder: 0,
    notifiedReminderAt: '',
  },
];

const statusLabels: Record<TaskStatus, string> = {
  todo: 'To do',
  'in-progress': 'In progress',
  done: 'Done',
};

const priorityWeight: Record<TaskPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function compareStatusOrder(left: Task, right: Task): number {
  if (left.statusOrder !== right.statusOrder) {
    return left.statusOrder - right.statusOrder;
  }

  if (left.priority !== right.priority) {
    return priorityWeight[left.priority] - priorityWeight[right.priority];
  }

  return right.createdAt.localeCompare(left.createdAt);
}

function compareBoardOrder(left: Task, right: Task): number {
  if (left.status !== right.status) {
    return boardStatuses.indexOf(left.status) - boardStatuses.indexOf(right.status);
  }

  return compareStatusOrder(left, right);
}

function normalizeTask(task: Partial<Task>, index: number): Task {
  return {
    id: task.id ?? crypto.randomUUID(),
    title: task.title ?? '',
    notes: task.notes ?? '',
    priority: task.priority ?? 'medium',
    status: task.status ?? 'todo',
    category: task.category ?? '',
    dueDate: task.dueDate ?? '',
    reminderAt: task.reminderAt ?? '',
    createdAt: task.createdAt ?? new Date().toISOString(),
    statusOrder: typeof task.statusOrder === 'number' ? task.statusOrder : index,
    notifiedReminderAt: task.notifiedReminderAt ?? '',
  };
}

function resequenceTasks(tasks: Task[]): Task[] {
  return boardStatuses.flatMap((status) =>
    tasks
      .filter((task) => task.status === status)
      .sort(compareStatusOrder)
      .map((task, index) => ({ ...task, statusOrder: index })),
  );
}

function getNextStatusOrder(tasks: Task[], status: TaskStatus): number {
  return tasks.filter((task) => task.status === status).length;
}

function isDueSoon(task: Task): boolean {
  if (!task.dueDate || task.status === 'done') {
    return false;
  }

  const dueTime = new Date(`${task.dueDate}T23:59:59`).getTime();
  const now = Date.now();
  const twoDays = 1000 * 60 * 60 * 24 * 2;

  return dueTime >= now && dueTime - now <= twoDays;
}

function isReminderActive(task: Task): boolean {
  if (!task.reminderAt || task.status === 'done') {
    return false;
  }

  return new Date(task.reminderAt).getTime() <= Date.now();
}

function formatReminder(task: Task): string {
  return task.reminderAt ? new Date(task.reminderAt).toLocaleString() : 'off';
}

function loadTasks(): Task[] {
  const saved = window.localStorage.getItem(STORAGE_KEY);

  if (!saved) {
    return sampleTasks;
  }

  try {
    const parsed = JSON.parse(saved) as Partial<Task>[];
    return resequenceTasks(parsed.map(normalizeTask));
  } catch {
    return sampleTasks;
  }
}

function App() {
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks());
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [category, setCategory] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [reminderAt, setReminderAt] = useState('');
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [activeView, setActiveView] = useState<TaskView>('board');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [draftTask, setDraftTask] = useState<EditableTaskFields | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [activeDropColumn, setActiveDropColumn] = useState<TaskStatus | null>(null);
  const [dropTargetTaskId, setDropTargetTaskId] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermissionState>(() => {
      if (typeof window === 'undefined' || !('Notification' in window)) {
        return 'unsupported';
      }

      return window.Notification.permission;
    });
  const [dataMessage, setDataMessage] = useState('');
  const [dataMessageTone, setDataMessageTone] = useState<MessageTone>('neutral');
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    if (notificationPermission !== 'granted') {
      return undefined;
    }

    const emitNotifications = () => {
      const remindersToNotify = tasks.filter(
        (task) =>
          isReminderActive(task) &&
          task.reminderAt !== '' &&
          task.notifiedReminderAt !== task.reminderAt,
      );

      if (remindersToNotify.length === 0) {
        return;
      }

      remindersToNotify.forEach((task) => {
        new window.Notification(task.title, {
          body: task.notes || `Category: ${task.category || 'General'}`,
          tag: `task-master-${task.id}-${task.reminderAt}`,
        });
      });

      setTasks((current) =>
        current.map((task) =>
          remindersToNotify.some((candidate) => candidate.id === task.id)
            ? { ...task, notifiedReminderAt: task.reminderAt }
            : task,
        ),
      );
    };

    emitNotifications();
    const intervalId = window.setInterval(emitNotifications, 60_000);

    return () => window.clearInterval(intervalId);
  }, [notificationPermission, tasks]);

  const categories = useMemo(
    () =>
      Array.from(
        new Set(tasks.map((task) => task.category.trim()).filter(Boolean)),
      ).sort((left, right) => left.localeCompare(right)),
    [tasks],
  );

  const visibleTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return tasks.filter((task) => {
      if (filter !== 'all' && task.status !== filter) {
        return false;
      }

      if (categoryFilter !== 'all' && task.category !== categoryFilter) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return [task.title, task.notes, task.priority, task.status, task.category]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [categoryFilter, filter, query, tasks]);

  const filteredTasks = useMemo(
    () => [...visibleTasks].sort(compareBoardOrder),
    [visibleTasks],
  );

  const tasksByStatus = useMemo(
    () =>
      boardStatuses.reduce(
        (columns, taskStatus) => ({
          ...columns,
          [taskStatus]: filteredTasks.filter((task) => task.status === taskStatus),
        }),
        { todo: [], 'in-progress': [], done: [] } as Record<TaskStatus, Task[]>,
      ),
    [filteredTasks],
  );

  const reminderTasks = useMemo(
    () =>
      filteredTasks
        .filter((task) => task.reminderAt)
        .sort(
          (left, right) =>
            new Date(left.reminderAt).getTime() - new Date(right.reminderAt).getTime(),
        ),
    [filteredTasks],
  );

  const activeReminderTasks = useMemo(
    () => reminderTasks.filter(isReminderActive),
    [reminderTasks],
  );

  const upcomingReminderTasks = useMemo(
    () => reminderTasks.filter((task) => !isReminderActive(task)),
    [reminderTasks],
  );

  const metrics = useMemo(
    () => ({
      total: tasks.length,
      active: tasks.filter((task) => task.status !== 'done').length,
      done: tasks.filter((task) => task.status === 'done').length,
      highPriority: tasks.filter((task) => task.priority === 'high').length,
      dueSoon: tasks.filter(isDueSoon).length,
    }),
    [tasks],
  );

  function setStatusMessage(message: string, tone: MessageTone) {
    setDataMessage(message);
    setDataMessageTone(tone);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!title.trim()) {
      return;
    }

    const nextTask: Task = {
      id: crypto.randomUUID(),
      title: title.trim(),
      notes: notes.trim(),
      priority,
      status,
      category: category.trim(),
      dueDate,
      reminderAt,
      createdAt: new Date().toISOString(),
      statusOrder: getNextStatusOrder(tasks, status),
      notifiedReminderAt: '',
    };

    setTasks((current) => resequenceTasks([...current, nextTask]));
    setTitle('');
    setNotes('');
    setPriority('medium');
    setStatus('todo');
    setCategory('');
    setDueDate('');
    setReminderAt('');
    setStatusMessage('Task created.', 'success');
  }

  function updateTask(id: string, updates: Partial<Task>) {
    setTasks((current) =>
      resequenceTasks(
        current.map((task) => {
          if (task.id !== id) {
            return task;
          }

          const nextReminderAt = updates.reminderAt ?? task.reminderAt;

          return {
            ...task,
            ...updates,
            notifiedReminderAt:
              nextReminderAt !== task.reminderAt
                ? ''
                : updates.notifiedReminderAt ?? task.notifiedReminderAt,
          };
        }),
      ),
    );
  }

  function moveTask(taskId: string, nextStatus: TaskStatus, beforeTaskId: string | null) {
    setTasks((current) => {
      const draggedTask = current.find((task) => task.id === taskId);

      if (!draggedTask || beforeTaskId === taskId) {
        return current;
      }

      const remainingTasks = current.filter((task) => task.id !== taskId);

      const nextTasks = boardStatuses.flatMap((statusName) => {
        const group = remainingTasks
          .filter((task) => task.status === statusName)
          .sort(compareStatusOrder);

        if (statusName !== nextStatus) {
          return group;
        }

        const insertedTask = {
          ...draggedTask,
          status: nextStatus,
        };
        const insertIndex = beforeTaskId
          ? group.findIndex((task) => task.id === beforeTaskId)
          : group.length;

        if (insertIndex === -1) {
          return [...group, insertedTask];
        }

        return [
          ...group.slice(0, insertIndex),
          insertedTask,
          ...group.slice(insertIndex),
        ];
      });

      return resequenceTasks(nextTasks);
    });
  }

  function moveTaskWithinColumn(taskId: string, direction: 'up' | 'down') {
    setTasks((current) => {
      const target = current.find((task) => task.id === taskId);

      if (!target) {
        return current;
      }

      const group = current
        .filter((task) => task.status === target.status)
        .sort(compareStatusOrder);
      const currentIndex = group.findIndex((task) => task.id === taskId);
      const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

      if (currentIndex === -1 || nextIndex < 0 || nextIndex >= group.length) {
        return current;
      }

      const reorderedGroup = [...group];
      const [movedTask] = reorderedGroup.splice(currentIndex, 1);
      reorderedGroup.splice(nextIndex, 0, movedTask);

      const otherTasks = current.filter((task) => task.status !== target.status);
      const nextTasks = boardStatuses.flatMap((statusName) => {
        if (statusName === target.status) {
          return reorderedGroup;
        }

        return otherTasks.filter((task) => task.status === statusName).sort(compareStatusOrder);
      });

      return resequenceTasks(nextTasks);
    });

    setStatusMessage(
      direction === 'up' ? 'Task moved up.' : 'Task moved down.',
      'neutral',
    );
  }

  function startEditing(task: Task) {
    setEditingTaskId(task.id);
    setDraftTask({
      title: task.title,
      notes: task.notes,
      priority: task.priority,
      category: task.category,
      dueDate: task.dueDate,
      reminderAt: task.reminderAt,
    });
  }

  function cancelEditing() {
    setEditingTaskId(null);
    setDraftTask(null);
  }

  function saveEditing(id: string) {
    if (!draftTask || !draftTask.title.trim()) {
      return;
    }

    updateTask(id, {
      title: draftTask.title.trim(),
      notes: draftTask.notes.trim(),
      priority: draftTask.priority,
      category: draftTask.category.trim(),
      dueDate: draftTask.dueDate,
      reminderAt: draftTask.reminderAt,
    });
    cancelEditing();
    setStatusMessage('Task updated.', 'success');
  }

  function handleDragStart(taskId: string) {
    setDraggedTaskId(taskId);
  }

  function clearDragState() {
    setDraggedTaskId(null);
    setActiveDropColumn(null);
    setDropTargetTaskId(null);
  }

  function handleDragEnd() {
    clearDragState();
  }

  function handleColumnDragOver(event: DragEvent<HTMLElement>, nextStatus: TaskStatus) {
    event.preventDefault();
    setActiveDropColumn(nextStatus);
    setDropTargetTaskId(null);
  }

  function handleTaskDragOver(
    event: DragEvent<HTMLElement>,
    nextStatus: TaskStatus,
    targetTaskId: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setActiveDropColumn(nextStatus);
    setDropTargetTaskId(targetTaskId);
  }

  function handleColumnDrop(nextStatus: TaskStatus) {
    if (!draggedTaskId) {
      return;
    }

    moveTask(draggedTaskId, nextStatus, null);
    clearDragState();
    setStatusMessage(`Task moved to ${statusLabels[nextStatus]}.`, 'neutral');
  }

  function handleTaskDrop(
    event: DragEvent<HTMLElement>,
    nextStatus: TaskStatus,
    targetTaskId: string,
  ) {
    event.preventDefault();
    event.stopPropagation();

    if (!draggedTaskId) {
      return;
    }

    moveTask(draggedTaskId, nextStatus, targetTaskId);
    clearDragState();
    setStatusMessage(`Task reordered in ${statusLabels[nextStatus]}.`, 'neutral');
  }

  function deleteTask(id: string) {
    if (editingTaskId === id) {
      cancelEditing();
    }

    setTasks((current) => resequenceTasks(current.filter((task) => task.id !== id)));
    setStatusMessage('Task deleted.', 'neutral');
  }

  function snoozeReminder(id: string, minutes = defaultSnoozeMinutes) {
    updateTask(id, {
      reminderAt: toLocalDateTimeInput(new Date(Date.now() + minutes * 60_000)),
      notifiedReminderAt: '',
    });
    setStatusMessage(`Reminder snoozed for ${minutes} minutes.`, 'success');
  }

  function dismissReminder(id: string) {
    updateTask(id, {
      reminderAt: '',
      notifiedReminderAt: '',
    });
    setStatusMessage('Reminder dismissed.', 'success');
  }

  async function requestNotificationPermission() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported');
      return;
    }

    const permission = await window.Notification.requestPermission();
    setNotificationPermission(permission);
  }

  function exportTasks() {
    const payload: ExportPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      tasks: resequenceTasks(tasks),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = objectUrl;
    link.download = `task-master-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.URL.revokeObjectURL(objectUrl);
    setStatusMessage('Tasks exported as JSON.', 'success');
  }

  function openImportPicker() {
    importInputRef.current?.click();
  }

  async function importTasks(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const fileText = await file.text();
      const parsed = JSON.parse(fileText) as Partial<Task>[] | ExportPayload;
      const importedTasks = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.tasks)
          ? parsed.tasks
          : null;

      if (!importedTasks) {
        throw new Error('Invalid Task Master export format.');
      }

      setTasks(resequenceTasks(importedTasks.map(normalizeTask)));
      cancelEditing();
      clearDragState();
      setStatusMessage(`Imported ${importedTasks.length} tasks.`, 'success');
    } catch {
      setStatusMessage('Import failed. Choose a Task Master JSON export.', 'error');
    } finally {
      event.target.value = '';
    }
  }

  function handleDragHandleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    task: Task,
    position: number,
    total: number,
  ) {
    if (event.key === 'ArrowUp') {
      event.preventDefault();

      if (position > 0) {
        moveTaskWithinColumn(task.id, 'up');
      }
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();

      if (position < total - 1) {
        moveTaskWithinColumn(task.id, 'down');
      }
    }
  }

  function renderTaskCard(task: Task, options: TaskCardOptions) {
    const isEditing = editingTaskId === task.id && draftTask !== null;
    const isActiveReminder = isReminderActive(task);
    const cardClasses = [
      'task-card',
      draggedTaskId === task.id ? 'task-card-dragging' : '',
      isDueSoon(task) ? 'task-card-due-soon' : '',
      isActiveReminder ? 'task-card-reminder' : '',
      dropTargetTaskId === task.id ? 'task-card-drop-target' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <article
        className={cardClasses}
        key={task.id}
        onDragEnd={handleDragEnd}
        onDragOver={(event) => handleTaskDragOver(event, task.status, task.id)}
        onDrop={(event) => handleTaskDrop(event, task.status, task.id)}
      >
        <div className="task-card-top">
          <div className="task-card-heading">
            <div className="badge-row">
              <span className={`badge badge-${task.priority}`}>{task.priority}</span>
              <span className="badge badge-status">{statusLabels[task.status]}</span>
              {task.category ? <span className="badge badge-category">{task.category}</span> : null}
              {isDueSoon(task) ? <span className="badge badge-warning">Due soon</span> : null}
              {isActiveReminder ? <span className="badge badge-alert">Reminder</span> : null}
            </div>
            {isEditing ? (
              <input
                value={draftTask.title}
                onChange={(event) =>
                  setDraftTask((current) =>
                    current ? { ...current, title: event.target.value } : current,
                  )
                }
                placeholder="Task title"
              />
            ) : (
              <h3>{task.title}</h3>
            )}
          </div>
          <div className="card-button-row">
            {options.showBoardControls ? (
              <>
                <button
                  aria-label={`Drag ${task.title}. Use arrow keys to reorder within ${statusLabels[task.status]}.`}
                  className="drag-handle"
                  draggable
                  onDragStart={() => handleDragStart(task.id)}
                  onKeyDown={(event) =>
                    handleDragHandleKeyDown(event, task, options.position, options.total)
                  }
                  type="button"
                >
                  Grip
                </button>
                <div className="reorder-controls" aria-label="Reorder task">
                  <button
                    className="ghost-button reorder-button"
                    disabled={options.position === 0}
                    onClick={() => moveTaskWithinColumn(task.id, 'up')}
                    type="button"
                  >
                    Up
                  </button>
                  <button
                    className="ghost-button reorder-button"
                    disabled={options.position === options.total - 1}
                    onClick={() => moveTaskWithinColumn(task.id, 'down')}
                    type="button"
                  >
                    Down
                  </button>
                </div>
              </>
            ) : null}

            {isEditing ? (
              <>
                <button className="ghost-button" onClick={cancelEditing} type="button">
                  Cancel
                </button>
                <button onClick={() => saveEditing(task.id)} type="button">
                  Save
                </button>
              </>
            ) : (
              <>
                <button className="ghost-button" onClick={() => startEditing(task)} type="button">
                  Edit
                </button>
                <button className="ghost-button" onClick={() => deleteTask(task.id)} type="button">
                  Delete
                </button>
              </>
            )}
          </div>
        </div>

        {isEditing ? (
          <div className="edit-grid">
            <textarea
              value={draftTask.notes}
              onChange={(event) =>
                setDraftTask((current) =>
                  current ? { ...current, notes: event.target.value } : current,
                )
              }
              placeholder="Task notes"
              rows={4}
            />
            <div className="task-actions task-actions-edit">
              <select
                value={draftTask.priority}
                onChange={(event) =>
                  setDraftTask((current) =>
                    current
                      ? {
                          ...current,
                          priority: event.target.value as TaskPriority,
                        }
                      : current,
                  )
                }
              >
                <option value="low">Low priority</option>
                <option value="medium">Medium priority</option>
                <option value="high">High priority</option>
              </select>
              <input
                value={draftTask.category}
                onChange={(event) =>
                  setDraftTask((current) =>
                    current ? { ...current, category: event.target.value } : current,
                  )
                }
                placeholder="Category"
              />
              <input
                type="date"
                value={draftTask.dueDate}
                onChange={(event) =>
                  setDraftTask((current) =>
                    current ? { ...current, dueDate: event.target.value } : current,
                  )
                }
              />
              <input
                type="datetime-local"
                value={draftTask.reminderAt}
                onChange={(event) =>
                  setDraftTask((current) =>
                    current ? { ...current, reminderAt: event.target.value } : current,
                  )
                }
              />
            </div>
          </div>
        ) : (
          <>
            {task.notes ? <p>{task.notes}</p> : null}

            <div className="task-meta">
              <span>
                Due {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'anytime'}
              </span>
              <span>Reminder {formatReminder(task)}</span>
              <span>Added {new Date(task.createdAt).toLocaleDateString()}</span>
            </div>

            {options.showReminderActions && isActiveReminder ? (
              <div className="reminder-actions">
                <button
                  className="ghost-button"
                  onClick={() => snoozeReminder(task.id)}
                  type="button"
                >
                  Snooze 15 min
                </button>
                <button
                  className="ghost-button"
                  onClick={() => dismissReminder(task.id)}
                  type="button"
                >
                  Dismiss reminder
                </button>
              </div>
            ) : null}

            <div className="task-actions">
              <select
                value={task.priority}
                onChange={(event) =>
                  updateTask(task.id, {
                    priority: event.target.value as TaskPriority,
                  })
                }
              >
                <option value="low">Low priority</option>
                <option value="medium">Medium priority</option>
                <option value="high">High priority</option>
              </select>

              <input
                value={task.category}
                onChange={(event) => updateTask(task.id, { category: event.target.value })}
                placeholder="Category"
              />
            </div>
          </>
        )}
      </article>
    );
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Task Master</p>
          <h1>Run your workload instead of reacting to it.</h1>
          <p className="hero-copy">
            Build a list that stays useful: capture work fast, track status, and
            surface the tasks that deserve attention.
          </p>
        </div>
        <div className="metric-grid">
          <article>
            <span>Total</span>
            <strong>{metrics.total}</strong>
          </article>
          <article>
            <span>Active</span>
            <strong>{metrics.active}</strong>
          </article>
          <article>
            <span>Done</span>
            <strong>{metrics.done}</strong>
          </article>
          <article>
            <span>High priority</span>
            <strong>{metrics.highPriority}</strong>
          </article>
          <article>
            <span>Due soon</span>
            <strong>{metrics.dueSoon}</strong>
          </article>
        </div>
      </section>

      <section className="workspace-grid">
        <form className="task-form panel" onSubmit={handleSubmit}>
          <div className="panel-heading">
            <h2>Add task</h2>
            <p>Capture the next piece of work with enough detail to act on it.</p>
          </div>

          <label>
            <span>Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ship dashboard update"
            />
          </label>

          <label>
            <span>Notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="What matters, what is blocked, what good looks like"
              rows={4}
            />
          </label>

          <div className="form-row">
            <label>
              <span>Priority</span>
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value as TaskPriority)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>

            <label>
              <span>Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as TaskStatus)}
              >
                <option value="todo">To do</option>
                <option value="in-progress">In progress</option>
                <option value="done">Done</option>
              </select>
            </label>

            <label>
              <span>Category</span>
              <input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="Design, Ops, Sales"
              />
            </label>

            <label>
              <span>Due date</span>
              <input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </label>

            <label>
              <span>Reminder</span>
              <input
                type="datetime-local"
                value={reminderAt}
                onChange={(event) => setReminderAt(event.target.value)}
              />
            </label>
          </div>

          <button type="submit">Create task</button>

          <div className="data-tools">
            <div>
              <h3>Data</h3>
              <p>Export your task board to JSON or import a saved Task Master file.</p>
            </div>
            <div className="data-tool-actions">
              <button onClick={exportTasks} type="button">
                Export JSON
              </button>
              <button className="ghost-button" onClick={openImportPicker} type="button">
                Import JSON
              </button>
            </div>
            <input
              accept="application/json"
              className="visually-hidden"
              onChange={importTasks}
              ref={importInputRef}
              type="file"
            />
            {dataMessage ? (
              <p className={`data-message data-message-${dataMessageTone}`} role="status">
                {dataMessage}
              </p>
            ) : null}
          </div>
        </form>

        <section className="panel board">
          <div className="panel-heading board-toolbar">
            <div>
              <h2>{activeView === 'board' ? 'Board' : 'Reminders'}</h2>
              <p>
                {activeView === 'board'
                  ? 'Filter the list, reorder work, and drag tasks between lanes.'
                  : 'See fired reminders, upcoming pings, and notification status in one place.'}
              </p>
            </div>
            <div className="toolbar-stack">
              <div className="view-switch" role="tablist" aria-label="Task views">
                <button
                  className={activeView === 'board' ? 'view-switch-active' : 'ghost-button'}
                  onClick={() => setActiveView('board')}
                  type="button"
                >
                  Board
                </button>
                <button
                  className={activeView === 'reminders' ? 'view-switch-active' : 'ghost-button'}
                  onClick={() => setActiveView('reminders')}
                  type="button"
                >
                  Reminders
                </button>
              </div>
              <div className="toolbar-controls toolbar-controls-wide">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search tasks"
                />
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  <option value="all">All categories</option>
                  {categories.map((taskCategory) => (
                    <option key={taskCategory} value={taskCategory}>
                      {taskCategory}
                    </option>
                  ))}
                </select>
                <select
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as TaskFilter)}
                >
                  <option value="all">All statuses</option>
                  <option value="todo">To do</option>
                  <option value="in-progress">In progress</option>
                  <option value="done">Done</option>
                </select>
              </div>
            </div>
          </div>

          {activeView === 'board' ? (
            <div className="board-columns">
              {boardStatuses.map((columnStatus) => (
                <section
                  className={[
                    'board-column',
                    activeDropColumn === columnStatus ? 'board-column-active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  key={columnStatus}
                  onDragLeave={() =>
                    setActiveDropColumn((current) =>
                      current === columnStatus ? null : current,
                    )
                  }
                  onDragOver={(event) => handleColumnDragOver(event, columnStatus)}
                  onDrop={() => handleColumnDrop(columnStatus)}
                >
                  <div className="column-header">
                    <div>
                      <h3>{statusLabels[columnStatus]}</h3>
                      <p>{tasksByStatus[columnStatus].length} tasks</p>
                    </div>
                  </div>

                  <div className="task-list">
                    {tasksByStatus[columnStatus].map((task, index, columnTasks) =>
                      renderTaskCard(task, {
                        showBoardControls: true,
                        showReminderActions: false,
                        position: index,
                        total: columnTasks.length,
                      }),
                    )}

                    {tasksByStatus[columnStatus].length === 0 ? (
                      <div className="empty-state empty-state-column">
                        <h3>Nothing here yet.</h3>
                        <p>Drag a task into this lane or create one with this status.</p>
                      </div>
                    ) : null}
                  </div>
                </section>
              ))}

              {filteredTasks.length === 0 ? (
                <div className="empty-state board-empty-state">
                  <h3>No tasks match the current filter.</h3>
                  <p>Change the search or create a new task to keep moving.</p>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="reminders-view">
              <section className="notification-banner">
                <div>
                  <h3>Browser notifications</h3>
                  <p>
                    {notificationPermission === 'granted'
                      ? 'Notifications are enabled. Task Master will ping when a reminder becomes active.'
                      : notificationPermission === 'denied'
                        ? 'Notifications are blocked in the browser. You can re-enable them from browser settings.'
                        : notificationPermission === 'unsupported'
                          ? 'This browser does not support notifications.'
                          : 'Enable notifications so reminders can surface even when the tab is in the background.'}
                  </p>
                </div>
                <button
                  disabled={
                    notificationPermission === 'granted' ||
                    notificationPermission === 'denied' ||
                    notificationPermission === 'unsupported'
                  }
                  onClick={requestNotificationPermission}
                  type="button"
                >
                  {notificationPermission === 'granted'
                    ? 'Notifications enabled'
                    : 'Enable notifications'}
                </button>
              </section>

              <section className="reminder-section">
                <div className="section-heading">
                  <h3>Due now</h3>
                  <p>{activeReminderTasks.length} active reminders</p>
                </div>
                <div className="reminder-grid">
                  {activeReminderTasks.map((task, index, reminderGroup) =>
                    renderTaskCard(task, {
                      showBoardControls: false,
                      showReminderActions: true,
                      position: index,
                      total: reminderGroup.length,
                    }),
                  )}
                  {activeReminderTasks.length === 0 ? (
                    <div className="empty-state">
                      <h3>No active reminders.</h3>
                      <p>When a reminder time passes, it will appear here until the task is completed or rescheduled.</p>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="reminder-section">
                <div className="section-heading">
                  <h3>Upcoming</h3>
                  <p>{upcomingReminderTasks.length} scheduled reminders</p>
                </div>
                <div className="reminder-grid">
                  {upcomingReminderTasks.map((task, index, reminderGroup) =>
                    renderTaskCard(task, {
                      showBoardControls: false,
                      showReminderActions: false,
                      position: index,
                      total: reminderGroup.length,
                    }),
                  )}
                  {upcomingReminderTasks.length === 0 ? (
                    <div className="empty-state">
                      <h3>No upcoming reminders.</h3>
                      <p>Add reminder times to tasks and they will be listed here.</p>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

export default App;
