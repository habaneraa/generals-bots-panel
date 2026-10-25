import { ChartNoAxesCombined, History, Play, Terminal } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';

const tabs = [
  { id: 'start', label: '启动', caption: '运行与参数', icon: Play },
  { id: 'stats', label: '统计', caption: '真实对局概览', icon: ChartNoAxesCombined },
  { id: 'history', label: '对局记录', caption: '历史与快照', icon: History },
  { id: 'logs', label: '日志', caption: '实时输出', icon: Terminal },
] as const;

export type TabId = (typeof tabs)[number]['id'];

type Props = { active: TabId; onChange: (tab: TabId) => void };

export function Navigation({ active, onChange }: Props) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % tabs.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index + tabs.length - 1) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    onChange(tabs[next]!.id);
    buttons.current[next]?.focus();
  }

  return (
    <nav
      className="flex gap-1 overflow-x-auto px-3 pb-3 [scrollbar-width:none] lg:flex-col lg:gap-1.5 lg:overflow-visible lg:px-4 lg:pb-0"
      role="tablist"
      aria-label="控制台页面"
    >
      {tabs.map(({ id, label, caption, icon: Icon }, index) => {
        const selected = active === id;
        return (
          <button
            key={id}
            ref={(button) => {
              buttons.current[index] = button;
            }}
            id={`tab-${id}`}
            className={`group flex shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm transition-colors lg:w-full ${
              selected
                ? 'bg-lime font-semibold text-forest-950 shadow-sm'
                : 'text-white/60 hover:bg-white/5 hover:text-white'
            }`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`panel-${id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <Icon size={17} strokeWidth={2} aria-hidden="true" />
            <span className="whitespace-nowrap">{label}</span>
            <span
              className={`ml-auto hidden text-[10px] font-normal lg:block ${
                selected ? 'text-forest-950/50' : 'text-white/25'
              }`}
            >
              {caption}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
