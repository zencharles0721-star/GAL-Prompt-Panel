(() => {
  'use strict';
  const D = window.PROMPT_DATA;
  const $ = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const format = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
  const allGroups = [...D.groups, D.reference];
  const customKeys = {scene:'customScene',pose:'customPose',outfit:'customOutfit'};
  const APP_VERSION = '1.0';
  let state = clone(D.defaults), history = [], favorites = [], view = {common:true,advanced:false}, edited = false, storageFailed = false, toastTimer;
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function cleanFavorites(items) {
    return Array.isArray(items) ? items.filter(x => isObject(x) && isObject(x.state)).map(x => ({name:typeof x.name === 'string' ? x.name.slice(0,80) : '未命名收藏',state:sanitize(x.state),edited:x.edited === true,prompt:typeof x.prompt === 'string' ? x.prompt : ''})) : [];
  }
  function sanitize(raw) {
    const result = clone(D.defaults);
    if (!raw || typeof raw !== 'object') return result;
    if (D.characters.some(c => c.id === raw.character)) result.character = raw.character;
    for (const group of allGroups) if (group.options.includes(raw[group.key])) result[group.key] = raw[group.key];
    for (const key of [...Object.values(customKeys),...D.groups.filter(g => g.extraInput).map(g => g.extraInput.key),'extra']) if (typeof raw[key] === 'string') result[key] = raw[key];
    if (Array.isArray(raw.locks)) result.locks = D.locks.filter(l => raw.locks.includes(l.id)).map(l => l.id);
    if (Array.isArray(raw.styleEnhancements)) result.styleEnhancements = D.styleEnhancements.filter(e => raw.styleEnhancements.includes(e.id)).map(e => e.id);
    if (typeof raw.styleBase === 'string' && Object.prototype.hasOwnProperty.call(D.styles,raw.styleBase) && D.styles[raw.styleBase]?.kind !== 'quality') result.styleBase = raw.styleBase;
    if (D.styles[result.style]?.kind !== 'quality') result.styleBase = result.style;
    return result;
  }
  let restoredPrompt;
  try {
    const saved = JSON.parse(localStorage.getItem(D.storageKey) || 'null');
    if (saved) {
      state = sanitize(saved.state);
      history = Array.isArray(saved.history) ? saved.history.filter(x => x && typeof x.short === 'string' && x.state).slice(0,10).map(x => ({short:x.short,state:sanitize(x.state)})) : [];
      // 未手动编辑的旧全文按最新角色数据重建，保留旧状态和历史结构。
      if (saved.edited === true && typeof saved.prompt === 'string') restoredPrompt = saved.prompt;
      edited = saved.edited === true;
      favorites = cleanFavorites(saved.favorites);
      if (isObject(saved.view)) view = {common:saved.view.common !== false,advanced:saved.view.advanced === true};
    }
  } catch (_) { storageFailed = true; }
  function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2600); }
  function save() {
    try { localStorage.setItem(D.storageKey, JSON.stringify(snapshot())); }
    catch (_) { if (!storageFailed) toast('浏览器限制本地保存，本次仍可正常使用'); storageFailed = true; }
    if (storageFailed) document.querySelector('.local-badge').textContent = '本地运行 · 保存不可用';
  }
  function snapshot() { return {state,history,prompt:$('full-prompt').value,edited,favorites,view}; }
  function restoreCombination(item) {
    state = sanitize(item.state); sync();
    $('short-prompt').textContent = shortPrompt();
    edited = item.edited === true && typeof item.prompt === 'string';
    $('full-prompt').value = edited ? item.prompt : buildPrompt();
    $('edit-state').textContent = edited ? '已手动编辑' : '可直接编辑';
    $('full-prompt').scrollTop = 0; save();
  }
  function renderFavorites() {
    $('favorites').replaceChildren();
    if (!favorites.length) { const p = document.createElement('p'); p.className = 'empty-history'; p.textContent = '暂无收藏，保存一组常用搭配吧。'; $('favorites').append(p); }
    favorites.forEach((item,index) => {
      const row = document.createElement('div'); row.className = 'favorite-row';
      const restore = button(item.name, () => { restoreCombination(item); toast('已恢复收藏：' + item.name); }); restore.className = 'favorite-restore'; restore.setAttribute('aria-label','恢复收藏：' + item.name);
      const remove = button('删除', () => { favorites.splice(index,1); renderFavorites(); save(); toast('已删除收藏'); }); remove.setAttribute('aria-label','删除收藏：' + item.name);
      row.append(restore,remove); $('favorites').append(row);
    });
  }
  function exportConfig() {
    const blob = new Blob([JSON.stringify({app:'GAL-Prompt-Panel',version:APP_VERSION,...snapshot()},null,2)],{type:'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'GAL-Prompt-Panel-V1.0-config.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),60000); toast('已导出配置 JSON');
  }
  async function importConfig(file) {
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('文件超过 5 MB');
      const data = JSON.parse((await file.text()).replace(/^\uFEFF/,''));
      if (!isObject(data) || !isObject(data.state) || !D.characters.some(c => c.id === data.state.character)) throw new Error('缺少有效的组合配置');
      if (data.app !== undefined && data.app !== 'GAL-Prompt-Panel') throw new Error('不是本项目的配置');
      if (data.version !== undefined && data.version !== APP_VERSION) throw new Error('不支持此配置版本');
      for (const key of ['favorites','history']) if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].some(x => !isObject(x) || !isObject(x.state)))) throw new Error(key === 'favorites' ? '收藏格式不正确' : '最近使用格式不正确');
      // 校验完成后再修改当前状态；只读取配置，不加载外部 Master 或脚本。
      const importedFavorites = cleanFavorites(data.favorites);
      const merged = [...favorites];
      for (const item of importedFavorites) if (!merged.some(x => JSON.stringify(x) === JSON.stringify(item))) merged.push(item);
      const importedHistory = (data.history || []).filter(x => typeof x.short === 'string').map(x => ({short:x.short,state:sanitize(x.state)}));
      history = [...importedHistory,...history].filter((item,i,items) => items.findIndex(x => x.short === item.short) === i).slice(0,10);
      favorites = merged;
      if (isObject(data.view)) view = {common:data.view.common !== false,advanced:data.view.advanced === true};
      $('common-options').open = view.common; $('advanced-options').open = view.advanced;
      restoreCombination(data); renderFavorites(); renderHistory(); toast('已导入配置，收藏与最近使用已合并');
    } catch (error) { toast('导入失败：' + (error instanceof SyntaxError ? 'JSON 格式不正确' : error.message)); }
  }
  function button(label, handler, className = '') { const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.className = className; node.addEventListener('click', handler); return node; }
  function createGroup(group, container) {
    const field = document.createElement('div'); field.className = 'field';
    const heading = document.createElement('h3'); heading.textContent = group.label; heading.id = 'label-' + group.key; field.append(heading);
    const choices = document.createElement('div'); choices.className = 'choices'; choices.setAttribute('role','group'); choices.setAttribute('aria-labelledby',heading.id);
    for (const option of group.options) {
      const b = button(option, () => { state[group.key] = option; if (group.key === 'style' && D.styles[option]?.kind !== 'quality') state.styleBase = option; update(); if (option === '自定义') $(customKeys[group.key]).focus(); if (option === group.extraInput?.option) $(group.extraInput.key).focus(); });
      b.dataset.group = group.key; b.dataset.value = option; choices.append(b);
    }
    field.append(choices);
    if (group.key === 'style') {
      const recommendation = document.createElement('p'); recommendation.id = 'style-recommendation'; recommendation.className = 'note'; recommendation.setAttribute('aria-live','polite'); field.append(recommendation);
      const baseNote = document.createElement('p'); baseNote.id = 'style-base-note'; baseNote.className = 'note'; field.append(baseNote);
      const title = document.createElement('h3'); title.id = 'style-enhancements-label'; title.textContent = '画风附加强化 · 可多选'; field.append(title);
      const extras = document.createElement('div'); extras.className = 'choices'; extras.setAttribute('role','group'); extras.setAttribute('aria-labelledby',title.id);
      D.styleEnhancements.forEach(e => { const b = button(e.label, () => { state.styleEnhancements = state.styleEnhancements.includes(e.id) ? state.styleEnhancements.filter(id => id !== e.id) : [...state.styleEnhancements,e.id]; update(); }); b.dataset.styleEnhancement = e.id; extras.append(b); });
      field.append(extras);
    }
    if (group.custom) { const input = document.createElement('input'); input.id = customKeys[group.key]; input.placeholder = '输入自定义' + group.label; input.setAttribute('aria-label',input.placeholder); input.addEventListener('input', () => { state[input.id] = input.value; generate(); }); field.append(input); }
    if (group.extraInput) { const input = document.createElement('input'); input.id = group.extraInput.key; input.placeholder = group.extraInput.label; input.setAttribute('aria-label',input.placeholder); input.addEventListener('input', () => { state[input.id] = input.value; generate(); }); field.append(input); }
    container.append(field);
  }
  function selectedCharacter() { return D.characters.find(c => c.id === state.character); }
  function members() { const c = selectedCharacter(); return c.members ? c.members.map(id => D.characters.find(x => x.id === id)) : [c]; }
  function value(key) {
    const extra = D.groups.find(g => g.key === key)?.extraInput;
    if (extra && state[key] === extra.option) return extra.option + '：' + (state[extra.key].trim() || '待填写');
    return state[key] === '自定义' ? (state[customKeys[key]].trim() || '自定义' + D.groups.find(g => g.key === key).label + '（待填写）') : state[key];
  }
  function outfitPrompt() {
    return [format(D.templates.outfit,{outfit:value('outfit')}),D.outfitRules.general,
      D.absoluteTerritoryOutfits.includes(state.outfit) ? D.outfitRules.absoluteTerritory : '',
      D.cosOutfits.includes(state.outfit) ? D.outfitRules.cos : ''].filter(Boolean).join('\n');
  }
  function enhancements() { return D.styleEnhancements.filter(e => state.styleEnhancements.includes(e.id)); }
  function styleShort() {
    const name = D.styles[state.style]?.short || state.style;
    return name + (D.styles[state.style]?.kind === 'quality' ? '（基础：' + state.styleBase + '）' : '') + enhancements().map(e => '＋' + e.label).join('');
  }
  function stylePrompt() {
    // 兼容原有字符串画风；结构化画风使用 prompt。精修等级保留此前基础画风。
    const text = name => typeof D.styles[name] === 'string' ? D.styles[name] : D.styles[name]?.prompt || '';
    const selected = D.styles[state.style];
    const base = selected?.kind === 'quality' ? state.styleBase : state.style;
    const foundation = D.styles[base]?.foundation;
    return ['主画风：' + base,
      selected?.kind === 'quality' ? '精修等级：' + state.style : '',
      foundation ? '人物精修基础：' + foundation + '\n' + text(foundation) : '',
      text(base), selected?.kind === 'quality' ? text(state.style) : '',
      enhancements().length ? '附加强化：' + enhancements().map(e => e.prompt).join(' + ') : '',
      D.styleRules].filter(Boolean).join('\n\n');
  }
  function shortPrompt() { return [selectedCharacter().short,state.hairStyle,value('scene'),state.time,state.weather,value('pose'),state.expression,state.focal,state.camera,state.angle,state.framing,value('outfit'),styleShort(),state.ratio].join('｜'); }
  function buildPrompt() {
    const people = members(), character = selectedCharacter();
    const masterText = (c, key) => c.master?.[key]?.trim() || format(D.templates.masterFallback,{name:c.name,part:D.masterParts[key]});
    // 合照按角色集中输出完整三项；保持 17 段顺序，后续三段引用独立设定。
    const characterBlocks = people.map(c => '【' + c.name + '】\n' + (c.identity || '') +
      (character.members ? '\n' + ['face','body','hair'].map(key => key.toUpperCase() + ':\n' + masterText(c,key)).join('\n\n') : '')).join('\n\n');
    const master = key => character.members ? format(D.masterSectionReference,{part:key.toUpperCase()}) : masterText(character,key);
    const lock = ids => D.locks.filter(l => ids.includes(l.id) && state.locks.includes(l.id)).map(l => l.text).join('');
    const positions = character.members ? format(D.templates.positions,{positions:people.map((c,i) => character.positions[i] + '＝' + c.name).join('，')}) : '';
    let expression = state.expression;
    if (expression === '三人不同表情') expression = character.members ? people.map(c => c.short + '＝' + (D.expressionsByCharacter[c.id] || '自然')).join('，') : format(D.templates.soloExpression,{expression:D.expressionsByCharacter[character.id] || '自然'});
    const sections = [
      [format(D.templates.identity,{names:people.map(c => c.name).join('、')}),D.masterPriority,positions,character.rules,lock(['identity']),characterBlocks].filter(Boolean).join('\n\n'),
      master('face') + lock(['face']), master('body') + lock(['body','volume']), master('hair') + lock(['hair']),
      [state.hairStyle + '：' + D.hairStyles[state.hairStyle],D.hairStyleRules,...people.map(c => D.hairStyleCharacterRules[c.id] ? '【' + c.name + '】' + D.hairStyleCharacterRules[c.id] : '')].filter(Boolean).join('\n'),
      D.referenceScopes[state.reference] + D.templates.referenceBan + lock(['noReference']),
      outfitPrompt(),format(D.templates.pose,{pose:value('pose')}),expression,
      [state.focal,state.camera,state.angle,state.framing].join('，'),
      format(D.templates.composition,state) + positions + (state.extra.trim() ? '\n' + format(D.templates.extra,{extra:state.extra.trim()}) : ''),
      value('scene'),state.time,state.weather,state.light,stylePrompt(),[D.templates.negative,character.rules].filter(Boolean).join('\n')
    ];
    return sections.map((text,i) => `${i+1}. ${D.sections[i]}\n${text}`).join('\n\n');
  }
  function generate() { $('short-prompt').textContent = shortPrompt(); $('full-prompt').value = buildPrompt(); edited = false; $('edit-state').textContent = '可直接编辑'; save(); }
  function renderPresets() {
    $('presets').replaceChildren();
    for (const preset of D.presets[state.character] || []) $('presets').append(button(preset.name, () => { Object.assign(state,preset.values); update(); remember(); toast('已应用：' + preset.name); }));
  }
  function sync() {
    document.querySelectorAll('[data-character]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.character === state.character)));
    document.querySelectorAll('[data-group]').forEach(b => b.setAttribute('aria-pressed',String(state[b.dataset.group] === b.dataset.value)));
    document.querySelectorAll('[data-lock]').forEach(b => b.setAttribute('aria-pressed',String(state.locks.includes(b.dataset.lock))));
    document.querySelectorAll('[data-style-enhancement]').forEach(b => b.setAttribute('aria-pressed',String(state.styleEnhancements.includes(b.dataset.styleEnhancement))));
    const recommended = D.styleRecommendations[state.scene];
    $('style-recommendation').textContent = recommended ? '推荐：' + recommended.join(' / ') + '（仅供参考，自由选择）' : '画风可自由选择，场景不会自动切换画风。';
    $('style-base-note').hidden = D.styles[state.style]?.kind !== 'quality';
    $('style-base-note').textContent = '高精GAL为精修等级，当前基础：' + state.styleBase + '。先选择其他画风，再点高精GAL可更换基础。';
    for (const [key,id] of Object.entries(customKeys)) { $(id).hidden = state[key] !== '自定义'; $(id).value = state[id]; }
    for (const group of D.groups.filter(g => g.extraInput)) { const extra = group.extraInput; $(extra.key).hidden = state[group.key] !== extra.option; $(extra.key).value = state[extra.key]; }
    $('extra').value = state.extra;
    const c = selectedCharacter();
    $('identity-note').textContent = c.members ? '固定站位：' + members().map((m,i) => c.positions[i] + '＝' + m.short).join(' · ') + '。角色身份彼此独立。' : c.name + ' · 独立角色身份与 Master，所有造型保持成年女性设定。';
    renderPresets();
  }
  function update() { sync(); generate(); }
  function renderHistory() {
    $('history').replaceChildren();
    if (!history.length) { const p = document.createElement('p'); p.className = 'empty-history'; p.textContent = '还没有记录，完成一组搭配后复制试试。'; $('history').append(p); }
    history.forEach(item => $('history').append(button(item.short, () => { state = sanitize(item.state); update(); toast('已恢复这组搭配'); }, 'history-item')));
  }
  function remember() { const short = shortPrompt(); history = [{short,state:clone(state)},...history.filter(h => h.short !== short)].slice(0,10); renderHistory(); save(); }
  async function copy(kind) {
    const content = kind === 'short' ? shortPrompt() : $('full-prompt').value;
    if (!content.trim()) { toast('内容为空，请先重新生成'); return; }
    let copied = false;
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(content); copied = true; } } catch (_) { /* file:// 或权限限制时使用选择复制 */ }
    if (!copied) {
      const previous = document.activeElement, y = window.scrollY;
      const input = document.createElement('textarea'); input.value = content; input.setAttribute('readonly',''); input.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px;'; document.body.append(input);
      input.focus(); input.select(); input.setSelectionRange(0,content.length);
      try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
      input.remove(); previous?.focus({preventScroll:true}); window.scrollTo(0,y);
    }
    if (copied) { remember(); toast(kind === 'short' ? '短句已复制' : '完整 Prompt 已复制'); }
    else { const target = kind === 'full' ? $('full-prompt') : $('short-prompt'); if (kind === 'full') { target.focus(); target.select(); } else { const range = document.createRange(); range.selectNodeContents(target); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); } toast('自动复制受限，已选中内容，请长按或按 Ctrl+C 复制'); }
  }
  D.characters.forEach(c => { const b = button('', () => { state.character = c.id; update(); }); b.dataset.character = c.id; const symbol = document.createElement('span'); symbol.className = 'character-symbol'; symbol.textContent = c.symbol; symbol.setAttribute('aria-hidden','true'); const name = document.createElement('span'); name.textContent = c.name; b.append(symbol,name); $('characters').append(b); });
  const commonKeys = ['style','scene','pose','expression','outfit','framing','ratio'];
  D.groups.forEach(g => createGroup(g,$(commonKeys.includes(g.key) ? 'option-groups' : 'advanced-groups'))); createGroup(D.reference,$('reference-group'));
  $('advanced-options').append($('constraints')); $('constraints').classList.remove('card');
  for (const [id,key] of [['common-options','common'],['advanced-options','advanced']]) { $(id).open = view[key]; $(id).addEventListener('toggle', () => { view[key] = $(id).open; save(); }); }
  D.locks.forEach(l => { const b = button(l.label, () => { state.locks = state.locks.includes(l.id) ? state.locks.filter(id => id !== l.id) : [...state.locks,l.id]; update(); }); b.dataset.lock = l.id; $('locks').append(b); });
  $('lock-all').addEventListener('click', () => { state.locks = D.locks.map(l => l.id); update(); });
  $('extra').addEventListener('input', e => { state.extra = e.target.value; generate(); });
  $('full-prompt').addEventListener('input', () => { edited = true; $('edit-state').textContent = '已手动编辑'; save(); });
  $('regenerate').addEventListener('click', () => { generate(); remember(); toast('已按当前选项重新生成'); });
  $('randomize').addEventListener('click', () => { for (const key of D.randomKeys) { const options = D.groups.find(g => g.key === key).options.filter(o => o !== '自定义' && (selectedCharacter().members || o !== '三人不同表情')); state[key] = options[Math.floor(Math.random()*options.length)]; } update(); remember(); toast('已随机搭配，角色与 Master 保持不变'); });
  $('clear').addEventListener('click', () => { const character = state.character; state = clone(D.defaults); state.character = character; update(); toast('已清空自定义内容并重置搭配，保留角色与最近使用'); });
  $('copy-short').addEventListener('click', () => copy('short')); $('copy-full').addEventListener('click', () => copy('full'));
  $('favorite-save').addEventListener('click', () => { const item = {name:$('favorite-name').value.trim() || shortPrompt().slice(0,80),state:clone(state),edited,prompt:$('full-prompt').value}; if (favorites.some(x => JSON.stringify(x) === JSON.stringify(item))) { toast('这组配置已收藏'); return; } favorites.push(item); $('favorite-name').value = ''; renderFavorites(); save(); toast('已收藏当前组合'); });
  $('export-config').addEventListener('click',exportConfig);
  $('import-config').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async e => { const file = e.target.files[0]; e.target.value = ''; await importConfig(file); });
  $('prompt-top').addEventListener('click', () => { $('full-prompt').scrollTop = 0; });
  $('prompt-bottom').addEventListener('click', () => { $('full-prompt').scrollTop = $('full-prompt').scrollHeight; });
  sync(); $('short-prompt').textContent = shortPrompt(); $('full-prompt').value = restoredPrompt ?? buildPrompt(); $('edit-state').textContent = edited ? '已手动编辑' : '可直接编辑'; renderHistory(); renderFavorites(); save();
})();
