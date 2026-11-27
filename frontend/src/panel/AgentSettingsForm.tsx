import { useEditor } from '../model/store';
import { issuesFor, type Issue } from '../model/validate';
import { Field } from './Field';

export function AgentSettingsForm({ issues }: { issues: Issue[] }) {
  const draft = useEditor((s) => s.draft);
  const updateAgent = useEditor((s) => s.updateAgent);

  return (
    <div className="form">
      <Field label="Agent name" issues={issuesFor(issues, 'name')}>
        <input value={draft.name} onChange={(e) => updateAgent({ name: e.target.value })} autoFocus />
      </Field>
      <Field
        label="Persona"
        hint="The global role message, applied to every node that doesn't override it."
        issues={issuesFor(issues, 'persona')}
      >
        <textarea rows={6} value={draft.persona} onChange={(e) => updateAgent({ persona: e.target.value })} />
      </Field>
      <Field label="ElevenLabs voice ID" issues={issuesFor(issues, 'voiceId')}>
        <input className="mono" value={draft.voiceId} onChange={(e) => updateAgent({ voiceId: e.target.value })} />
      </Field>
      <Field label="OpenAI model" issues={issuesFor(issues, 'model')}>
        <input className="mono" value={draft.model} onChange={(e) => updateAgent({ model: e.target.value })} />
      </Field>
    </div>
  );
}
