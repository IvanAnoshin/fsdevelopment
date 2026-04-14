export default function FirstPinPrompt({ open = false, onDismiss, onSetup }) {
  if (!open) return null;

  return (
    <div className="pa-first-pin-prompt pa-glass" role="dialog" aria-modal="false" aria-labelledby="pa-first-pin-title">
      <div className="pa-first-pin-kicker">Быстрый вход</div>
      <div className="pa-first-pin-title" id="pa-first-pin-title">Установить PIN-код на этом устройстве?</div>
      <div className="pa-first-pin-text">
        Вы ещё не включали локальный PIN. Он ускорит вход на этом устройстве и не заменяет пароль или секретный вопрос.
      </div>
      <div className="pa-first-pin-actions">
        <button type="button" className="pa-secondary-btn" onClick={onDismiss}>Позже</button>
        <button type="button" className="pa-primary-btn" onClick={onSetup}>Установить PIN</button>
      </div>
    </div>
  );
}
