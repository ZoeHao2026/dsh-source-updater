import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client';
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import './model-select.css';
import './styles.css';
import type { PreferencesStore } from './preferences.js';
/**
 * Render the composer model seat.
 * @param props - owner share (locked) + injected face (shared directory
 * store/verbs) + the standard locale seat.
 * @returns the trigger and, while open, the two-level menu.
 */
export type CollapsibleModelSelectProps = Omit<ModelSelectInjected, 'select' | 'directory'> & {
    locked: boolean;
    preferences: PreferencesStore;
    directory: ObservableSnapshot<ModelDirectoryState>;
    select: (selection: ModelSelection) => Promise<Awaited<ReturnType<ModelSelectInjected['select']>> | boolean>;
} & PropsLocale<'model'>;
export declare function CollapsibleModelSelect({ locked, available, directory, load, select, t, preferences }: CollapsibleModelSelectProps): import("react/jsx-runtime").JSX.Element | null;
//# sourceMappingURL=CollapsibleModelSelect.d.ts.map