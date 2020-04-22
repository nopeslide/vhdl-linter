import { ParserBase } from './parser-base';
import { OSignal, OType, OArchitecture, OEntity, ParserError, OState, OFunction, OPackage, ORecord, OEnum, ORead, OI, ORecordChild, OName } from './objects';
import { SubtypeParser } from './subtype-parser';

export class DeclarativePartParser extends ParserBase {
  type: string;
  constructor(text: string, pos: OI, file: string, private parent: OArchitecture|OEntity|OPackage) {
    super(text, pos, file);
    this.debug('start');
  }
  parse(optional: boolean = false, lastWord = 'begin') {
    let nextWord = this.getNextWord({ consume: false }).toLowerCase();
    let multiSignals: string[] = [];
    while (nextWord !== lastWord) {
      if (nextWord === 'signal' || nextWord === 'constant') {
        const signal = new OSignal(this.parent, this.pos.i, this.getEndOfLineI());
        this.getNextWord();

        signal.constant = nextWord === 'constant';
        signal.name = new OName(signal, this.pos.i, this.pos.i);
        signal.name.text = this.getNextWord();
        signal.name.range.end.i = signal.name.range.start.i + signal.name.text.length;
        if (this.text[this.pos.i] === ',') {
          throw new ParserError(`Defining multiple signals not allowed!: ${this.getLine(this.pos.i)}`, this.pos.getRangeToEndLine());
          // multiSignals.push(signal.name);
          // this.expect(',');
          // continue;
        }
        this.expect(':');
        const iBeforeType = this.pos.i;
        const { typeReads, defaultValueReads } = this.getType(signal, false);
        signal.type = typeReads;
        signal.defaultValue = defaultValueReads;
        signal.range.end.i = this.pos.i;
        this.advanceSemicolon();
        // console.log(multiSignals, 'multiSignals');
        // for (const multiSignalName of multiSignals) {
        //   const multiSignal = new OSignal(this.parent, -1, -1);
        //   Object.assign(signal, multiSignal);
        //   multiSignal.name.text = multiSignalName;
        //   this.parent.signals.push(multiSignal);
        // }
        if (this.parent instanceof OPackage) {
          this.parent.constants.push(signal);
        } else {
          this.parent.signals.push(signal);
        }
        multiSignals = [];
      } else if (nextWord === 'attribute') {
        this.getNextWord();
        this.advancePast(';');
      } else if (nextWord === 'type') {
        const type = new OType(this.parent, this.pos.i, this.getEndOfLineI());
        this.getNextWord();
        type.name = this.getNextWord();
        this.expect('is');
        if (this.text[this.pos.i] === '(') {
          this.expect('(');
          let position = this.pos.i;
          Object.setPrototypeOf(type, OEnum.prototype);
          (type as OEnum).states = this.advancePast(')').split(',').map(stateName => {
            const state = new OState(type, position, this.getEndOfLineI(position));
            const match = stateName.match(/^\s*/);
            if (match) {
              state.range.start.i = position + match[0].length;
            }
            state.name = stateName.trim();
            state.range.end.i = state.range.start.i + state.name.length;
            position += stateName.length;
            position++;
            return state;
          });
          type.range.end.i = this.pos.i;
          this.parent.types.push(type);
          this.expect(';');
        } else if (this.test(/^[^;]*units/i)) {
          this.advancePast('units');
          type.units = [];
          type.units.push(this.getNextWord());
          this.advanceSemicolon();
          while (!this.test(/^end\s+units/i)) {
            type.units.push(this.getNextWord());
            this.advanceSemicolon();
          }
          this.expect('end');
          this.expect('units');
          type.range.end.i = this.pos.i;
          this.parent.types.push(type);
          this.expect(';');
        } else {
          const nextWord = this.getNextWord().toLowerCase();
          Object.setPrototypeOf(type, ORecord.prototype);
          (type as ORecord).children = [];
          if (nextWord === 'record') {
            let position = this.pos.i;
            let recordWord = this.getNextWord();
            while (recordWord.toLowerCase() !== 'end') {
              const child = new ORecordChild(type, position, position);
              child.name = recordWord;
              (type as ORecord).children.push(child);
              this.advanceSemicolon();
              child.range.end.i = this.pos.i;
              position = this.pos.i;
              recordWord = this.getNextWord();
            }
            this.maybeWord('record');
            this.maybeWord(type.name);
          }
          type.range.end.i = this.pos.i;
          this.parent.types.push(type);
          this.advancePast(';');
        }
      } else if (nextWord === 'subtype') {
        const subtypeParser = new SubtypeParser(this.text, this.pos, this.file, this.parent);

        const type = subtypeParser.parse();
        this.parent.types.push(type);
      } else if (nextWord === 'alias') {
        const type = new OType(this.parent, this.pos.i, this.getEndOfLineI());
        this.getNextWord();
        type.name = this.getNextWord();
        this.expect('is');
        this.parent.types.push(type);
        this.advanceSemicolon(true);
      } else if (nextWord === 'component') {
        this.getNextWord();
        const componentName = this.getNextWord();
        this.advancePast(/\bend\b/i, {allowSemicolon: true});
        this.maybeWord('component');
        this.maybeWord(componentName);
        this.expect(';');
      } else if (nextWord === 'impure' || nextWord === 'function' || nextWord === 'procedure') {
        if (nextWord === 'impure') {
          this.getNextWord();
        }
        const func = new OFunction(this.parent, this.pos.i, this.getEndOfLineI());
        this.getNextWord();
        func.name = this.advancePast(/^(\w+|"[^"]+")/, {returnMatch: true}).replace(/^"(.*)"$/, '$1');
        if (this.text[this.pos.i] === '(') {
          this.expect('(');
          func.parameter = this.advanceBrace();
        } else {
          func.parameter = '';
        }
        if (!(this.parent instanceof OPackage)) {
          this.advancePast(/\bend\b/i, {allowSemicolon: true});
          let word = this.getNextWord({consume: false});
          while (['case', 'loop', 'if'].indexOf(word.toLowerCase()) > -1) {
            this.advancePast(/\bend\b/i, {allowSemicolon: true});
            word = this.getNextWord({consume: false});
          }
        }
        func.range.end.i = this.pos.i;
        this.advancePast(';');
        this.parent.functions.push(func);
      } else if (optional) {
        return;
      } else if (nextWord === 'package' || nextWord === 'generic') {
        this.advanceSemicolon();
      } else if (nextWord === 'file') {
        this.advanceSemicolon();
      } else {
        this.getNextWord();
        throw new ParserError(`Unknown Ding: '${nextWord}' on line ${this.getLine()}`, this.pos.getRangeToEndLine());
      }
      nextWord = this.getNextWord({ consume: false }).toLowerCase();
    }
  }

}
