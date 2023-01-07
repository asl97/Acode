import tag from "html-tag-js";
import mimeTypes from 'mime-types';
import dialogs from "../components/dialogs";
import tile from "../components/tile";
import fsOperation from "../fileSystem/fsOperation";
import helpers from "../utils/helpers";
import Path from "../utils/Path";
import Url from "../utils/Url";
import constants from "./constants";
import openFolder from "./openFolder";
import run from './run';
import saveFile from './saveFile';
import appSettings from './settings';

const modelist = ace.require('ace/ext/modelist');
const { Fold } = ace.require('ace/edit_session/fold');
const { Range } = ace.require('ace/range');

/**
 * @typedef {'run'|'save'|'change'|'focus'|'blur'|'close'|'rename'|'load'|'loadError'|'loadStart'|'loadEnd'|'changeMode'|'changeEncoding'|'changeReadOnly'} FileEvents
 */

/**
 * @typedef {object}  FileOptions new file options
 * @property {boolean} [isUnsaved] weather file needs to saved
 * @property {render} [render] make file active
 * @property {string} [id] ID fo the file
 * @property {string} [uri] uri of the file
 * @property {string} [text] session text
 * @property {boolean} [editable] eable file to edit or not
 * @property {boolean} [deletedFile] file do not exists at source
 * @property {'single' | 'tree'} [SAFMode] storage access framework mode
 * @property {string} [encoding] text encoding
 * @property {object} [cursorPos] cursor position
 * @property {number} [scrollLeft] scroll left
 * @property {number} [scrollTop] scroll top
 * @property {Array<Fold>} [folds] folds
 */

export default class EditorFile {
  /**
   * If editor was focused before resize
   */
  focusedBefore = false;
  /**
   * State of the editor for this file.
   */
  focused = false;
  /**
   * Weather the file has completed loading text or not
   * @type {boolean}
   */
  loaded = true;
  /**
   * Weather file is still loading the text from the source
   * @type {boolean}
   */
  loading = false;
  /**
   * Weather file is deleted from source.
   * @type {boolean}
   */
  deletedFile = false;
  /**
   * EditSession of the file
   * @type {AceAjax.IEditSession}
   */
  session = null;
  /**
   * Encoding of the text e.e. 'utf-8'
   * @type {string}
   */
  encoding = 'utf-8';
  /**
   * Weather file is readonly
   * @type {boolean}
   */
  readOnly = false;
  /**
   * mark change when session text is changed
   * @type {boolean}
   */
  markChanged = true;
  /**
   * @type {string} file syntax highliting mode
   */
  #mode = 'ace/mode/text';
  /**
   * Storage access framework file mode
   * @type {'single' | 'tree' | null}
   */
  #SAFMode = null;
  /**
   * Name of the file
   * @type {string}
   */
  #name = constants.DEFAULT_FILE_NAME;
  /**
   * Location of the file
   * @type {string}
   */
  #uri;
  /**
   * Unique ID of the file, changed when file is renamed or location/uri is changed.
   * @type {string}
   */
  #id = constants.DEFAULT_FILE_SESSION;
  /**
   * Associated tile for the file, that is appened in the open file list,
   * when clicked make the file active.
   * @type {HTMLElement}
   */
  #tab;
  /**
   * Weather file can be edited or not
   * @type {boolean}
   */
  #editable = true;
  /**
   * contains information about cursor position, scroll left, scroll top, folds.
   */
  #loadOptions;
  /**
   * Weather file is changed and needs to be saved
   * @type {boolean}
   */
  #isUnsaved = false;
  /**
   * Whether to show run button or not
   */
  #canRun = Promise.resolve(false);
  #events = {
    save: [],
    change: [],
    focus: [],
    blur: [],
    close: [],
    rename: [],
    load: [],
    loaderror: [],
    loadstart: [],
    loadend: [],
    changemode: [],
    run: [],
    canrun: [],
  };

  onsave;
  onchange;
  onfocus;
  onblur;
  onclose;
  onrename;
  onload;
  onloaderror;
  onloadstart;
  onloadend;
  onchangeMode;
  onrun;
  oncanrun;

  /**
   * 
   * @param {string} [filename] name of file.
   * @param {FileOptions} [options]  file create options
   */
  constructor(filename, options) {
    const {
      addFile,
      getFile,
    } = editorManager;
    let doesExists = null;

    // if options are passed
    if (options) {
      // if options doesn't contains id, and provide a new id
      if (!options.id) {
        if (options.uri) this.#id = options.uri.hashCode();
        else this.#id = helpers.uuid();
      } else this.#id = options.id;
    } else if (!options) {
      // if options aren't passed, that means default file is being created
      this.#id = constants.DEFAULT_FILE_SESSION;
    }

    this.#uri = options?.uri;

    if (this.#id) doesExists = getFile(this.#id, 'id');
    else if (this.#uri) doesExists = getFile(this.#uri, 'uri');

    if (doesExists) {
      doesExists.makeActive();
      return;
    }

    if (filename) this.#name = filename;

    this.#tab = tile({
      text: this.#name,
      tail: tag('span', {
        className: 'icon cancel',
        dataset: {
          action: 'close-file'
        },
      }),
    });

    const editable = options?.editable ?? true;

    this.#SAFMode = options?.SAFMode;
    this.isUnsaved = options?.isUnsaved ?? false;
    this.encoding = options?.encoding ?? 'utf-8';
    // if options contains text property then there is no need to load
    // set loaded true i.e. text is no undefi

    if (this.#id !== constants.DEFAULT_FILE_SESSION) {
      this.loaded = options?.text !== undefined;
    }

    // if not loaded then create load options
    if (!this.loaded) {
      this.#loadOptions = {
        cursorPos: options?.cursorPos,
        scrollLeft: options?.scrollLeft,
        scrollTop: options?.scrollTop,
        folds: options?.folds,
        editable,
      };
    } else {
      this.editable = editable;
    }

    this.#tab.onclick = tabOnclick.bind(this);
    this.#tab.oncontextmenu = startDrag;

    addFile(this);
    this.session = ace.createEditSession(options?.text || '');
    this.setMode();
    this.#setupSession();

    if (options?.render ?? true) this.render();
  }

  /**
   * File unique id.
   */
  get id() {
    return this.#id;
  }

  /**
  * File unique id.
  * @param {string} value
  */
  set id(value) {
    this.#renameCacheFile(value);
    this.#id = value;
  }

  /**
   * File name
   */
  get filename() {
    return this.#name;
  }

  /**
   * File name
   * @param {string} value
   */
  set filename(value) {
    if (!value || this.#SAFMode === 'single') return;
    if (this.#name === value) return;

    const event = createFileEvent(this);
    this.#emit('rename', event);

    if (event.defaultPrevented) return;

    (async () => {
      if (this.id === constants.DEFAULT_FILE_SESSION) {
        this.id = helpers.uuid();
      }

      if (editorManager.activeFile.id === this.id) {
        editorManager.header.text = value;
      }

      const oldExt = helpers.extname(this.#name);
      const newExt = helpers.extname(value);

      this.#tab.text = value;
      this.#name = value;

      editorManager.onupdate('rename-file');
      editorManager.emit('rename-file', this);

      if (oldExt !== newExt) this.setMode();
    })();
  }

  /**
   * Location of the file i.e. dirname
   */
  get location() {
    if (this.#SAFMode === 'single') return null;
    if (this.#uri) {
      try {
        return Url.dirname(this.#uri)
      } catch (error) {
        return null;
      }
    }
    return null;
  }

  /**
   * Location of the file i.e. dirname
   * @param {string} value
   */
  set location(value) {
    if (!value) return;
    if (this.#SAFMode === 'single') return;
    if (this.location === value) return;

    const event = createFileEvent(this);
    this.#emit('rename', event);
    if (event.defaultPrevented) return;

    this.uri = Url.join(value, this.filename);
    this.readOnly = false;
  }

  /**
   * File location on the deive
   */
  get uri() {
    return this.#uri;
  }

  /**
   *  File location on the deive
   * @param {string} value
   */
  set uri(value) {
    if (this.#uri === value) return;
    if (!value) {
      this.deletedFile = true;
      this.isUnsaved = true;
      this.#uri = null;
      this.id = helpers.uuid();
    } else {
      this.#uri = value;
      this.deletedFile = false;
      this.readOnly = false;
      this.id = value.hashCode();
    }

    editorManager.onupdate('rename-file');
    editorManager.emit('rename-file', this);

    // if this file is active set sub text of header
    if (editorManager.activeFile.id === this.id) {
      editorManager.header.subText = this.#getTitle();
    }
  }

  /**
   * End of line
   */
  get eol() {
    return /\r/.test(this.session.getValue()) ? 'windows' : 'unix';
  }

  /**
   * End of line
   * @param {'windows'|'unit'} value
   */
  set eol(value) {
    if (this.eol === value) return;
    let text = this.session.getValue();

    if (value === 'windows') {
      text = text.replace(/(?<!\r)\n/g, '\r\n');
    } else {
      text = text.replace(/\r/g, '');
    }

    this.session.setValue(text);
  }

  /**
   * Weather file can be edit.
   */
  get editable() {
    return this.#editable;
  }

  /**
   * Weather file can be edit.
   * @param {boolean} value
   */
  set editable(value) {
    if (this.#editable === value) return;
    editorManager.editor.setReadOnly(!value);
    editorManager.onupdate('read-only');
    editorManager.emit('update', 'read-only');
    this.#editable = value;
  }

  get isUnsaved() {
    return this.#isUnsaved;
  }

  set isUnsaved(value) {
    if (this.#isUnsaved === value) return;
    this.#isUnsaved = value;

    this.#upadteSaveIcon();
    this.#updateTab();
  }

  /**
   * DON'T remove, plugin need this property to get filename.
   */
  get name() {
    return this.#name;
  }

  /**
   * Readonly, cahce file url
   */
  get cahceFile() {
    return Url.join(CACHE_STORAGE, this.#id);
  }

  /**
   * File icon
   */
  get icon() {
    const modeName = this.#mode.split('/').pop();
    const fileType = helpers.getFileType(this.filename);
    return `file file_type_${modeName} file_type_${fileType}`
  }

  get tab() {
    return this.#tab;
  }

  async writeToCache() {
    const text = this.session.getValue();
    const fs = fsOperation(this.cahceFile);

    try {
      if (!await fs.exists()) {
        await fsOperation(CACHE_STORAGE).createFile(this.id, text);
        return;
      }

      await fs.writeFile(text);
    } catch (error) {
      console.error(error);
    }
  }

  async isChanged() {
    // if file is not loaded or is loading then it is not changed.
    if (!this.loaded || this.loading) {
      return false;
    }
    // is changed is called when session text is changed
    // if file has no uri or is readonly that means file is change
    // and need to saved to a location.
    // here readonly means file has uri but has no write permission.
    if (!this.uri || this.readOnly) {
      // if file is defautl file and text is changed
      if (this.id === constants.DEFAULT_FILE_SESSION) {
        // change id when text is changed
        this.id = helpers.uuid();
      }
      return true;
    }

    const protocol = Url.getProtocol(this.#uri);
    let fs;
    if (/s?ftp:/.test(protocol)) {
      // if file is a ftp or sftp file, get file content forom cahced file.
      // remove ':' from protocol because cache file of remote files are
      // stored as ftp102525465N i.e. protocol + id
      const cacheFilename = protocol.slice(0, -1) + this.id;
      const cacheFile = Url.join(CACHE_STORAGE, cacheFilename);
      fs = fsOperation(cacheFile);
    } else {
      fs = fsOperation(this.uri);
    }

    try {
      const oldText = await fs.readFile(this.encoding);
      const text = this.session.getValue();

      if (oldText.length !== text.length) return true;
      return oldText !== text;
    } catch (error) {
      console.log(error);
      return false;
    }
  }

  async canRun() {
    if (!this.loaded || this.loading) return false;
    await this.readCanRun();
    return this.#canRun;
  }

  async readCanRun() {
    try {
      const event = createFileEvent(this);
      this.#emit('canrun', event);
      if (event.defaultPrevented) return;

      const folder = openFolder.find(this.uri);
      if (folder) {
        const url = Url.join(folder.url, 'index.html');
        const fs = fsOperation(url);
        if (await fs.exists()) {
          this.#canRun = Promise.resolve(true);
          return;
        }
      }

      const runnableFile = /\.((html?)|(md)|(js)|(svg))$/;
      if (runnableFile.test(this.filename)) {
        this.#canRun = Promise.resolve(true);
        return;
      }
      this.#canRun = Promise.resolve(false);
    } catch (error) {
      if (err instanceof Error) throw err;
      else throw new Error(err);
    }
  }

  /**
   * 
   * @param {()=>(boolean|Promise<boolean>)} cb callback function that return true if file can run
   */
  async writeCanRun(cb) {
    if (!cb || typeof cb !== 'function') return;
    const res = cb();
    if (res instanceof Promise) {
      this.#canRun = res;
      return;
    }

    this.#canRun = Promise.resolve(res);
  }

  /**
   * Remove and closes the file.
   * @param {boolean} force if true, will prompt to save the file
   */
  async remove(force = false) {
    if (this.id === constants.DEFAULT_FILE_SESSION && !editorManager.files.length) return;
    if (!force && this.isUnsaved) {
      const confirmation = await dialogs.confirm(strings.warning.toUpperCase(), strings['unsaved file']);
      if (!confirmation) return;
    }

    this.#destroy();

    editorManager.files = editorManager.files.filter((file) => file.id !== this.id);
    const { files, sidebar, activeFile } = editorManager;
    if (activeFile.id === this.id) {
      editorManager.activeFile = null;
    }
    if (!files.length) {
      sidebar.hide();
      editorManager.activeFile = null;
      new EditorFile();
    } else {
      files[files.length - 1].makeActive();
    }
    editorManager.onupdate('remove-file');
    editorManager.emit('remove-file', this);
  }

  /**
   * Saves the file.
   * @returns {Promise<boolean>} true if file is saved, false if not.
   */
  save() {
    return this.#save(false);
  }

  /**
   * Saves the file to a new location.
   * @returns {Promise<boolean>} true if file is saved, false if not.
   */
  saveAs() {
    return this.#save(true);
  }

  /**
   * Sets syntax highlighting of the file.
   * @param {string} [mode] 
   */
  setMode(mode) {
    const event = createFileEvent(this);
    this.#emit('changemode', event);
    if (event.defaultPrevented) return;

    if (!mode) {
      const ext = Path.extname(this.filename);
      const modes = helpers.parseJSON(localStorage.modeassoc);
      if (modes?.[ext]) mode = modes[ext];
      else mode = modelist.getModeForPath(this.filename).mode;
    }

    // sets ace editor EditSession mode
    this.session.setMode(mode);
    this.#mode = mode;

    // sets file icon
    this.#tab.lead(
      <span className={this.icon} style={{ paddingRight: '5px' }}></span>
    );
  }

  /**
   * Makes this file active
   */
  makeActive() {
    const { activeFile, editor, switchFile } = editorManager;
    if (activeFile?.id === this.id) return;

    activeFile?.removeActive();
    switchFile(this.id);

    if (this.focused) {
      editor.focus();
    } else {
      editor.blur();
    }

    this.#upadteSaveIcon();
    this.#tab.classList.add('active');
    this.#tab.scrollIntoView();
    if (!this.loaded && !this.loading) {
      this.#loadText();
    }

    editorManager.header.subText = this.#getTitle();

    this.#emit('focus', createFileEvent(this));
  }

  removeActive() {
    this.#emit('blur', createFileEvent(this));
  }

  openWith() {
    this.#fileAction('VIEW');
  }

  editWith() {
    this.#fileAction('EDIT', 'text/plain');
  }

  share() {
    this.#fileAction('SEND');
  }

  runAction() {
    this.#fileAction('RUN');
  }

  run() {
    this.#run(false);
  }

  runFile() {
    this.#run(true);
  }

  render() {
    this.makeActive();

    if (this.id !== constants.DEFAULT_FILE_SESSION) {
      const defaultFile = editorManager.getFile(constants.DEFAULT_FILE_SESSION, 'id');
      defaultFile?.remove();
    }
  }

  /**
   * Add event listener
   * @param {string} event
   * @param {(this:File, e:Event)=>void} callback
   */
  on(event, callback) {
    this.#events[event.toLowerCase()]?.push(callback);
  }

  /**
   * Remove event listener
   * @param {string} event
   * @param {(this:File, e:Event)=>void} callback
   */
  off(event, callback) {
    const events = this.#events[event.toLowerCase()];
    if (!events) return;
    const index = events.indexOf(callback);
    if (index > -1) events.splice(index, 1);
  }

  /**
   * 
   * @param {FileAction} action 
   */
  async #fileAction(action, mimeType) {
    try {
      const uri = await this.#getShareableUri();
      if (!mimeType) mimeType = mimeTypes.lookup(this.name);
      system.fileAction(uri, this.filename, action, mimeType, this.#showNoAppError);
    } catch (error) {
      toast(strings.error);
    }
  }

  async #getShareableUri() {
    if (!this.uri) return null;

    const fs = fsOperation(this.uri);

    if (/^s?ftp:/.test(this.uri)) return fs.localName;

    const { uri } = await fs.stat();
    return uri;
  }

  /**
   * Rename cache file.
   * @param {String} newId
   */
  async #renameCacheFile(newId) {
    try {
      const fs = fsOperation(this.cahceFile);
      if (!await fs.exists()) return;
      fs.renameTo(newId);
    } catch (error) {
      console.error('renameCahceFile', error);
    }
  }

  /**
   * Removes cache file
   */
  async #removeCache() {
    try {
      const fs = fsOperation(this.cahceFile);
      if (!await fs.exists()) return;
      await fs.delete();
    } catch (error) {
      console.error(error);
    }
  }

  async #loadText() {
    const {
      cursorPos,
      scrollLeft,
      scrollTop,
      folds,
      editable,
    } = this.#loadOptions;
    const { editor } = editorManager;
    let value;

    this.#loadOptions = null;

    editor.setReadOnly(true);
    this.loading = true;
    this.markChanged = false;
    this.#emit('loadstart', createFileEvent(this));
    this.session.setValue(strings['loading...']);

    try {
      const cacheFs = fsOperation(this.cahceFile);
      if (await cacheFs.exists()) {
        value = await cacheFs.readFile('utf-8');
      }

      if (this.uri) {
        const file = fsOperation(this.uri);
        if (!await file.exists()) {
          this.deletedFile = true;
          this.isUnsaved = true;
        } else if (value === undefined) {
          value = await file.readFile('utf-8');
        }
      }

      this.markChanged = false;
      this.session.setValue(value || '');
      this.loaded = true;
      this.loading = false;

      const { activeFile, emit } = editorManager;
      if (activeFile.id === this.id) {
        editor.setReadOnly(false);
      }

      setTimeout(() => {
        this.#emit('load', createFileEvent(this));
        emit('file-loaded', this);
        if (cursorPos) this.session.selection.moveCursorTo(cursorPos.row, cursorPos.column);
        if (scrollTop) this.session.setScrollTop(scrollTop);
        if (scrollLeft) this.session.setScrollLeft(scrollLeft);
        if (editable !== undefined) this.editable = editable;

        if (Array.isArray(folds)) {
          const parsedFolds = EditorFile.#parseFolds(folds);
          this.session.addFolds(parsedFolds);
        }
      }, 0);
    } catch (error) {
      this.#emit('loaderror', createFileEvent(this));
      this.remove();
      toast(`Unable to load: ${this.filename}`);
      console.log(error);
    } finally {
      this.#emit('loadend', createFileEvent(this));
    }
  }

  static #onfold(e) {
    editorManager.editor._emit('fold', e);
  }

  static #onscrolltop(e) {
    editorManager.editor._emit('scrolltop', e);
  }

  static #onscrollleft(e) {
    editorManager.editor._emit('scrollleft', e);
  }

  /**
   * Parse folds 
   * @param {Array<Fold>} folds 
   */
  static #parseFolds(folds) {
    if (!Array.isArray(folds)) return;
    const foldDataAr = [];
    folds.forEach(fold => {
      const { range } = fold;
      const { start, end } = range;
      const foldData = new Fold(
        new Range(
          start.row,
          start.column,
          end.row,
          end.column
        ),
        fold.placeholder,
      );

      if (fold.ranges.length > 0) {
        const subFolds = parseFolds(fold.ranges);
        foldData.subFolds = subFolds;
        foldData.ranges = subFolds;
      }

      foldDataAr.push(foldData);
    });
    return foldDataAr;
  }

  #save(as) {
    const event = createFileEvent(this);
    this.#emit('save', event);

    if (event.defaultPrevented) return Promise.resolve(false);
    return saveFile(this, as);
  }

  #run(file) {
    const event = createFileEvent(this);
    this.#emit('run', event);
    if (event.defaultPrevented) return;
    run(false, file ? 'inapp' : appSettings.value.previewMode, file);
  }

  #upadteSaveIcon() {
    const $save = root.get('#quick-tools [action=save]');
    if (this.#isUnsaved) {
      $save?.classList.add('notice');
    } else {
      $save?.classList.remove('notice');
    }
  }

  #updateTab() {
    if (this.#isUnsaved) {
      this.tab.classList.add('notice');
    } else {
      this.tab.classList.remove('notice');
    }
  }

  /**
   * Setup Ace EditSession for the file
   */
  #setupSession() {
    const { value: settings } = appSettings;

    this.session.setTabSize(settings.tabSize);
    this.session.setUseSoftTabs(settings.softTab);
    this.session.setUseWrapMode(settings.textWrap);
    this.session.setUseWorker(false);

    this.session.on('changeScrollTop', EditorFile.#onscrolltop);
    this.session.on('changeScrollLeft', EditorFile.#onscrollleft);
    this.session.on('changeFold', EditorFile.#onfold);
  }

  #destroy() {
    this.#emit('close', createFileEvent(this));
    this.session.off('changeScrollTop', EditorFile.#onscrolltop);
    this.session.off('changeScrollLeft', EditorFile.#onscrollleft);
    this.session.off('changeFold', EditorFile.#onfold);
    this.#removeCache();
    this.session.destroy();
    this.#tab.remove();
    delete this.session;
    this.#tab = null;
  }

  #showNoAppError() {
    toast(strings['no app found to handle this file']);
  }

  #getTitle() {
    let text = this.location || this.uri;

    if (text && !this.readOnly) {
      text = helpers.getVirtualPath(text);
      if (text.length > 30) text = '...' + text.slice(text.length - 27);
    } else if (this.readOnly) {
      text = strings['read only'];
    } else if (this.deletedFile) {
      text = strings['deleted file'];
    } else {
      text = strings['new file'];
    }
    return text;
  }

  /**
   * Emits an event
   * @param {FileEvents} eventName 
   * @param {FileEvent} event 
   */
  #emit(eventName, event) {
    this[`on${eventName}`]?.(event);
    if (!event.BUBBLING_PHASE) return;
    this.#events[eventName]?.some((fn) => {
      fn(event);
      return !event.BUBBLING_PHASE;
    });
  }
}

/**
 * 
 * @param {MouseEvent} e 
 * @returns 
 */
function tabOnclick(e) {
  e.preventDefault();
  const { action } = e.target.dataset;
  if (action === 'close-file') {
    this.remove();
    return;
  }
  this.makeActive();
}

/**
 * 
 * @param {MouseEvent} e 
 */
function startDrag(e) {
  const $el = e.target;
  const $parent = $el.parentElement;
  const event = (e) => (e.touches && e.touches[0]) || e;
  const opts = {
    passive: false,
  };

  let startX = event(e).clientX;
  let startY = event(e).clientY;
  let prevEnd = startX;
  let position;
  let left = $el.offsetLeft;
  let $placeholder = tag('div');

  const rect = $el.getBoundingClientRect();
  $el.style.zIndex = 999;
  $placeholder.style.height = `${rect.height}px`;
  $placeholder.style.width = `${rect.width}px`;

  if (appSettings.value.vibrateOnTap) {
    navigator.vibrate(constants.VIBRATION_TIME);
    $el.classList.add('select');
    $el.style.transform = `translate3d(${left}px, 0, 0)`;
    $parent.insertBefore($placeholder, $el);
  }
  document.addEventListener('mousemove', drag, opts);
  document.addEventListener('touchmove', drag, opts);
  document.ontouchmove = null;
  document.onmousemove = null;
  document.ontouchend = cancelDrag;
  document.onmouseup = cancelDrag;
  document.ontouchcancel = cancelDrag;
  document.onmouseleave = cancelDrag;

  function cancelDrag() {
    $el.classList.remove('select');
    $el.style.zIndex = 0;
    $el.style.transform = `translate3d(0, 0, 0)`;
    document.removeEventListener('mousemove', drag, opts);
    document.removeEventListener('touchmove', drag, opts);
    document.ontouchend = document.onmouseup = null;
    if ($placeholder.isConnected) {
      $parent.replaceChild($el, $placeholder);
      updateFileList($parent);
    }
    $el.eventAdded = false;
    document.ontouchend = null;
    document.onmouseup = null;
    document.ontouchcancel = null;
    document.onmouseleave = null;
  }

  function drag(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const end = event(e).clientX;

    position = prevEnd - end > 0 ? 'l' : 'r';
    prevEnd = end;
    const move = end - startX;
    const $newEl = document.elementFromPoint(end, startY);

    $el.style.transform = `translate3d(${left + move}px, 0, 0)`;

    if (
      $newEl.classList.contains('tile') &&
      $el !== $newEl &&
      $parent.contains($newEl)
    ) {
      if (position === 'r') {
        if ($newEl.nextElementSibling) {
          $parent.insertBefore($placeholder, $newEl.nextElementSibling);
        } else {
          $parent.append($placeholder);
        }
      } else {
        $parent.insertBefore($placeholder, $newEl);
      }
    }
  }
}

function updateFileList($parent) {
  const children = [...$parent.children];
  const newFileList = [];
  for (let el of children) {
    for (let file of editorManager.files) {
      if (file.tab === el) {
        newFileList.push(file);
        break;
      }
    }
  }

  editorManager.files = newFileList;
}

function createFileEvent(file) {
  return new FileEvent(file);
}

class FileEvent {
  #bubblingPhase = true;
  #defaultPrevented = false;
  target;
  constructor(file) {
    this.target = file;
  }
  stopPropagation() {
    this.#bubblingPhase = false;
  }
  preventDefault() {
    this.#defaultPrevented = true;
  }
  get BUBBLING_PHASE() {
    return this.#bubblingPhase;
  }
  get defaultPrevented() {
    return this.#defaultPrevented;
  }
}
