# CLI Canon アーキテクチャ設計書

- 状態: Proposed。設計レビュー用であり、実装済み・移行済みを意味しない。
- 作成日: 2026-09-22
- 対象: `yohn-jp/cli-canon`
- npm package identity: `@yohn-jp/cli-canon`
- 対象consumer: Inari、Nawabari、Wabachi、Suzukuri、Mottainai
- 変更範囲: 本設計書の提出。framework実装、依存追加、consumer変更、publish、mergeは含まない。

## 1. 結論

CLI Canonは、yohn-jpのTypeScript CLI製品に共通する構造を、一度だけ実装する内部frameworkである。中心はparserやutilityの寄せ集めではなく、**型付きの宣言を検証済みProduct Modelへコンパイルし、実行・help・Skill・機械可読契約をそこから構築すること**に置く。

単一の巨大ファイルをSoTにするのではない。各事実に唯一の所有者を定め、他の面では参照または投射だけを許す。製品のdomain model、認可、状態遷移、既存のschemaは、元の製品が所有し続ける。

本書の推奨基盤は **TypeScript + Zod 4 + Commander** とする。Zodはframework自身が所有するschemaの型推論・境界検証・機械可読projectionに、CommanderはCLI構文処理に利用する。CLI Canonはその上のProduct Model、関係制約、projection、適合性検証を所有する。

Effect SchemaとEffect CLIは有力な代替であり、型安全性の面で不適切なのではない。ただし今回確認した共通化対象は、domain runtimeの置換よりも宣言・参照・CLI境界の統一が中心である。Effectを必須にしても、このProduct Modelと製品固有の互換性検証は別途必要になる。現時点では、既存の関数・Promiseベースの製品境界を維持して導入できる構成を選ぶ。これは安全性や速度の実測順位ではなく、今回の目的と導入範囲に基づく設計判断である。

npmのscoped package名は先頭に`@`を付ける。GitHub repository名の`yohn-jp/cli-canon`とは区別する。公開repositoryであることと、一般用途のframeworkとして外部互換性を約束することも区別する。[N1]

## 2. 分析の根拠と限界

### 2.1 固定した分析基準

各repositoryの`main` refを取得し、以下のcommitへ固定して関連コードを読んだ。以後の`main`更新を本書の観測結果へ暗黙に混ぜない。

| 製品      | Repository          | 分析commit                                 |
| --------- | ------------------- | ------------------------------------------ |
| Inari     | `yohn-jp/gh-inari`  | `e82dc3cf23dee09d491f145c2782cdede59523eb` |
| Nawabari  | `yohn-jp/nawabari`  | `6b63542380fac428d1970f0303b93f700e9aa20c` |
| Wabachi   | `yohn-jp/wabachi`   | `d30d322247431814ccc00c9d353cb84735258d9b` |
| Suzukuri  | `yohn-jp/suzukuri`  | `94eaded74b26aa4dfb0c130687e0a99940ef8fb5` |
| Mottainai | `yohn-jp/mottainai` | `63affbd23f84c6cd23bf82d6e82e376b3a545d55` |

調査対象はcommand registry、CLI dispatch、Skill、path resolver、public manifest、package定義と関連テスト・package suiteである。全ファイルの完全監査、各製品のrelease可否判定、全テストの再実行ではない。観測した実装と、本書が新しく提案する規約を分けて記載する。

ソースと公式API文書は取得したが、この作業環境ではrepositoryのclone・依存取得を完了できていない。製品の`verify`、frameworkの型検証PoC、依存の脆弱性検査、起動時間・容量の比較は未実行である。以下のライブラリ選定は設計上の推奨であり、未測定の性能や互換性を保証しない。

### 2.2 横断結果

| 製品      | 採用する設計                                                                                                                                | そのまま移植しない部分                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Inari     | commandがoption適用範囲を所有する。Skillがcommand IDとdomainの判断結果を参照する。契約identityをversion付きで公開する。                     | `CommandId`/`OptionId`の手書きunion、全option共通の広いbindings型。repositoryで動的に決まるIssue契約をframeworkへ固定しない。     |
| Nawabari  | literalを保持したregistryからID型を導出する。parserの許可optionはregistryを直接読む。public manifestは既存authorityのprojectionと明示する。 | 手書きusage文字列。Git・claim・状態機械をCLI Canonへ移さない。生成Skill文書を、他製品と同じruntimeの`skill`コマンドだと扱わない。 |
| Wabachi   | command/optionの宣言とSkillのcommand参照を分離する。package検査で配布するdocs・Skill・binを確認する。                                       | helpの宣言とは別の手書きdispatch、option探索、version literal。Skillテキストの切り詰めを共通規約にはしない。                      |
| Suzukuri  | structured Skillとcommand projectionの関係検証、UTF-8 byte budget超過時の拒否、CLI entryとlibrary entryの分離。                             | `id: string`へ広げたcommand型、usage/example文字列、手書きdispatch。semantic projection engineそのものは移さない。                |
| Mottainai | `SkillCliResult`がstream/output/exitCodeを明示する。state path resolverがenv/platformを受け取る。                                           | 手書きUSAGE、flag parser、Skillのcommand文字列、JSON文字列も対象にする切り詰め。no-argsでMCP serverを起動する既存契約は保持する。 |

根拠: Inari [I1][I2][I3]、Nawabari [Nw1][Nw2][Nw3][Nw4]、Wabachi [W1][W2][W3][W4]、Suzukuri [S1][S2][S3][S4][S5]、Mottainai [M1][M2][M3][M4]。

これは製品全体の優劣の順位ではない。frameworkへ昇格させる構造ごとの選択である。

### 2.3 過大評価しない点

**registryの存在とexecutionの単一化は別である。** Suzukuriのregistryにはdispatchとhelpが共有すると説明があるが、確認した`runCli`にはcommand別の`if`分岐が残る。Wabachiもhelpは宣言から投射する一方、実行は別の分岐とoption探索を持つ。本書では両者を実行まで完全にSoT化済みとは扱わない。[S1][S2][W1][W2]

**型から投射しても自然言語の正しさは証明できない。** Skillのcommand IDが正しくても、手順・注意書きが現在のdomain契約と一致するかは別の検証が必要である。[I2][W3]

**出力超過の契約は一致していない。** Suzukuriは超過を拒否する。Wabachiはtextを切り詰め、JSONではエラー文書へ置き換える。MottainaiはJSONを含めた文字列をbyte単位で切るため、超過する入力ではJSON構造を失う経路がある。これはコード上の条件付き経路の分析であり、この作業で実行再現した報告ではない。[S3][W3][M2]

**同じ値が現在一致していてもSoTとは限らない。** Wabachiの`getVersion()`とpackage.jsonはともに`0.4.0`だが、別々のliteralである。現在のversion不一致とは報告せず、二重保守を解消する対象とする。[W2][W5]

## 3. Canonの所有境界

### 3.1 共通化する枠組み

| Canon            | 唯一のauthoring authority                          | 投射するもの                                           |
| ---------------- | -------------------------------------------------- | ------------------------------------------------------ |
| Product identity | installed package metadataへの参照と製品の公開名   | version、bin identity、discovery header                |
| Command          | command key、構文、input、handler binding          | route、許可option、usage、help、command manifest       |
| Input            | fieldごとの構文・presenceとvalue schema            | typed handler input、runtime decoder、入力説明         |
| Path             | product-owned root/segment/parameter宣言           | runtime address、defaultの説明、fixture内address       |
| Skill            | intent、command参照、手順、domain結果への参照      | index、scenario、text、JSON、配布文書                  |
| Output           | surfaceごとのencoding/stream/budget/error mapping  | 一貫したCLI response、bounded discovery                |
| Package/Fixture  | 配布宣言への参照、scenario inputと独立した期待結果 | packed consumer検証、source/built/packageの共通harness |

SoTの単位は「事実」である。例えばoptionの値域は既存domainのenumを参照し、framework用の同値enumを新設しない。package versionはpackage.jsonをauthorityとし、Product Modelに別のversion literalを要求しない。

### 3.2 製品側に残すもの

InariのIssue/Implementation/Change契約、署名・認可・provider transport、NawabariのGit/worktree/claim・filesystem安全性・XState lifecycle、WabachiのArchitecture Canonと分析provider、Suzukuriのsemantic adapter/view/budget engine、MottainaiのMCP gateway・task orchestration・runtime lifecycleは抽出しない。

CLI Canonはdomainへの呼出しを構築するが、domainの判断を代行しない。`readOnly`などの公開metadataを認可の証明に使わない。retry可能性もdomain結果に従い、共通runnerがmutationを自動再試行しない。

orgのIssue/PR governance、共有Actions、release orchestrationは`yohn-jp/.github`およびInariのauthorityである。CLI Canonへworkflowや規則のコピーを持ち込まない。共有package-testの実行部品と、何をCIの必須gateにするかは別の責務である。[G1]

## 4. 基盤選定の設計判断

### 4.1 選択肢

| 選択肢                                 | 借りられるもの                                                 | 残る自作部分・導入コスト                                                                      | 判定                                      |
| -------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------- |
| TypeScriptのtableのみ                  | literal inference、mapped types                                | runtime decoder、parser、projection、参照検証を広く自作                                       | 不採用                                    |
| Effect Schema + Effect CLI             | schemaの型/encode/decode、typed CLI primitives、Effectでの実行 | Product Model、Path/Skillの関係、公開形式、既存構文の互換性は別途必要。schemaのみの利用も可能 | 有力な代替。初版の必須基盤にはしない      |
| Zod 4 + Commander                      | schema型/検証/JSON Schema、既存のCLI構文処理                   | Product Modelとcompiler、command-specific型接続、関係検証は必要                               | 推奨                                      |
| Schema library + Node `util.parseArgs` | Node標準のoption解析とordered tokens                           | nested command、progressive help、optional-value等の構文層をさらに実装する必要                | より狭いCLIには適するが今回は既定にしない |

Effect Schemaは単一schemaから型・decode・encodeなどを得られる。Effect CLIにもtyped commandとhelp/usage/parse APIがある。したがって「Effectは全製品をEffectへ書き直さなければ使えない」は誤りである。一方、Effectを使うだけでcommandとSkillの参照整合性や認可の正しさまで保証されるわけでもない。[E1][E2]

Zod 4にはtyped metadata registryとJSON Schema projectionがある。ただしZodのschema registryはProduct Modelそのものではなく、command alias衝突やhandler欠落を検証する機能ではない。CLI Canonがこの関係検証を持つ。[Z1][Z2]

既存依存も一様ではない。InariはZod 4、MottainaiはZod 3を直接宣言し、他の3製品の確認したpackage.jsonにはEffect/Zodの直接依存がない。Zod採用でも追加・重複依存は発生し得る。「すでに全製品に入っているから無料」とは判断しない。[I4][M5][Nw5][W5][S5]

### 4.2 推奨構成の条件

初版は一つのschema authoring方式と一つのCLI backendに絞る。Effect/Zod/その他を差し替える汎用plugin frameworkは作らない。Commanderはprivate implementation detailとし、consumerへCommanderのmutable command objectや`.opts<T>()`を渡さない。handler型のauthorityはschemaからの推論であり、型assertionではない。

Zod schemaをauthoring APIとして受け取る以上、その依存は完全には隠れない。対応Zod majorを明示し、frameworkとconsumerの型互換性をpacked consumerで検証する。将来のschema基盤変更がconsumer無変更で済むとは約束しない。

runtime依存の宣言は`commander`を通常依存、authoring側に露出する`zod`を対応majorのpeer dependencyとする設計を基本とし、framework自身の開発環境には同一検証版を置く。Mottainaiの既存Zod 3をこの変更だけでZod 4へ全面移行しない。既存domain decoderとのboundaryで接続する。

### 4.3 parser互換性は別途証明する

Commanderのrequired option argumentは次のtokenがoption風でも値として消費する。対してMottainaiの`requireFlagValue`は別tokenの`--...`を欠落扱いにする。Inariにはcommand pathより前のoptionを扱うテストがあり、Nawabariには順序付きのresource/mode対がある。これらは単なるflag一覧への変換では保存できない。[C1][M1][I3][Nw1]

またEffect CLIも設定に既定のcase-sensitivityなどを持つ。どのbackendでも既定値が既存契約に合うと仮定してはならない。[E3]

本書はCommanderで全既存構文の互換性を実行確認したとは主張しない。初回のbackend実装は第12章の代表構文を満たすことをadmission条件とする。表現できない構文は`UNSUPPORTED_GRAMMAR`として構築を拒否し、そのcommandの移行を保留する。unknown option許可、値の取り直し、別parserへの暗黙fallbackでgreenにしない。

### 4.4 versionと依存の採用手続き

具体的な最新patch versionや脆弱性の不存在は、本調査では確定していない。初回実装PRで、Node 24およびconsumerのTypeScript範囲に対応するstable releaseを選び、lockfile、peer compatibility、ライセンス、advisory、推移依存、packed size、help/skillのcold-startを記録する。未測定の数値を採用根拠にしない。

Effectへの再判断は、既存Promise境界を超えた型付きerror/resource/cancellationの共通需要が実際に生じた場合、または同じadmission corpusで実装量と互換性に明確な利点を示した場合に行う。製品の状態機械やauthorizationを移すこととは切り離す。

## 5. アーキテクチャ

```text
product-owned declarations + existing domain references
                         |
                  define / bind
                         |
                  compileProduct
       shape -> references -> grammar -> projection checks
                         |
                CompiledProduct model
             /           |             \
      CLI adapter    pure projections   path resolver
          |          help/skill/manifest     |
   validated input         |          explicit PathContext
          |
    product handler -> existing domain authority
          |
   result boundary -> output policy -> CliIO

fixture scenarios + independent expected results
                         |
              source / built / packed harness
```

### 5.1 三つの表現を分ける

**Authoring Model**は人が編集する型付き宣言である。command key、field、path、Skill、handler参照を保持する。分割moduleの合成を許すが、同じIDの上書きmergeは禁止する。

**CompiledProduct**は参照・構文・公開projectionの検証を通った実行用modelである。公開されるdataはimmutableとし、mutable Map、schema registry、Commander instanceを外へ返さない。`Object.freeze(new Map())`だけで要素変更を防いだとは扱わない。型brandは通常の誤用を防ぐ仕組みであり、`any`や不正なJavaScriptに対するsecurity boundaryではない。

**Public Manifest**はJSONで表現できるdiscovery用projectionである。handler、closure、secret、内部schema object、XState snapshotを含めず、これを読み込んでコードを実行しない。Nawabariの「manifestはauthorityではなくprojection」という境界を採用する。[Nw4]

### 5.2 package境界

初期のpackageは一つとし、必要なimport境界をsubpathで分ける。

| Import                       | 責務                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `@yohn-jp/cli-canon`         | authoring型、compiler、純粋なhelp/Skill/manifest projection                    |
| `@yohn-jp/cli-canon/node`    | Commander接続、path context取得、CliIOとの接続                                 |
| `@yohn-jp/cli-canon/testing` | scenario harness、packed consumer検証部品。製品のruntime entryからimportしない |

root importで`process.argv`を読まない、commandを実行しない、signal handlerを登録しない、filesystem/networkへアクセスしない。Node adapterは明示的に起動する。testing依存が本番CLIのimport graphへ入らないことを検証する。複数npm packageへの先行分割はしない。

## 6. 不変条件と保証段階

| ID  | 不変条件                                                                            | 主な検証段階                          |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------- |
| C01 | command/option/path/Skill identityは宣言から導出し、別の手書きunionを持たない       | TypeScript、authoring API             |
| C02 | commandは自分のinputと実行bindingを所有する。実行可能commandにhandler欠落を許さない | TypeScript、compileProduct            |
| C03 | 参照不能ID、alias衝突、曖昧な構文、path参照cycleを拒否する                          | compileProduct                        |
| C04 | parser、usage、help、Skill内invocationは同じCompiledProductから構築する             | compiler構造、projection tests        |
| C05 | 外部入力はunknownとしてdecodeしてからhandlerへ渡す                                  | invocation boundary                   |
| C06 | domainのschema・認可・遷移を重複定義しない                                          | import boundary、review、domain tests |
| C07 | Pathはaddressであり権限ではない。解決はfilesystemを変更しない                       | API境界、runtime tests                |
| C08 | JSONと実行手順を黙って切らない。failureとexit outcomeを一致させる                   | renderer、byte boundary tests         |
| C09 | library importにCLI起動副作用を持たせない                                           | source/built/packed consumer tests    |
| C10 | fixture inputの共有とexpected oracleの独立性を両立する                              | scenario authoring、contract tests    |
| C11 | productの既存公開契約をframework導入の都合で変更しない                              | frozen compatibility corpus           |
| C12 | 生成artifactは編集対象ではなく、同一宣言から再生成・差分検出する                    | generate/check、package tests         |

TypeScriptだけで任意の構文非曖昧性、filesystem状態、descriptionの正しさ、handlerの意味を証明するとは言わない。型検査、構築時検査、実行時検査、独立した期待値による検証を重ねる。

## 7. 型付きauthoring model

### 7.1 宣言の組み立て方

一つの巨大なgeneric objectへ全てを押し込むより、`fields -> commands -> handlers/skills -> product`の順で型を確定する。cross-referenceは確定済みのcatalog keyまたはtyped handleを使う。

以下は**提案APIの説明用コード**であり、実装済みAPIや型検証済みサンプルではない。仮想製品の例であって、既存Wabachiの構文変更を要求しない。

```ts
import * as z from "zod";
import { defineCommands, bindHandlers, defineSkills } from "@yohn-jp/cli-canon";

const commands = defineCommands({
  "document.render": {
    route: ["document", "render"],
    summary: "Render an explicit document.",
    input: {
      file: { positional: "file", presence: "required", value: z.string().min(1) },
      out: { flags: ["--out"], presence: "required", value: z.string().min(1) },
    },
    result: z.object({ writtenFile: z.string() }),
  },
});

const handlers = bindHandlers(commands)({
  "document.render": async ({ file, out }) => {
    // file/outの型はinput宣言から導出する。
    return { writtenFile: await renderDocument(file, out) };
  },
});

const skills = defineSkills(commands)({
  renderDocument: {
    whenToUse: "文書を出力するとき",
    steps: [{ command: "document.render", summary: "入力と出力先を指定する" }],
  },
});
```

`CommandId`は`keyof`相当で導出する。handler mapは実行可能commandに対して過不足なく対応し、input/resultはそれぞれのschemaから導出する。Skillの`command`を存在しないIDへ変えると型エラーになる設計とする。一般のstring入力やJavaScriptからのauthoringにも構築時の同等検査を行う。

### 7.2 fieldのauthorityを重複させない

fieldには二種類の情報がある。flags/position/cardinality/presenceはCLI構文、value schemaは値の意味である。例えば`presence: required`とschema側のoptional/defaultで欠落規則を二重定義してはならない。value schemaは値が存在するときのschemaとし、optional/default/repeatedのwrapperはfield declarationから一度だけ構築する。

値域、enum、境界値をhelp専用の配列へコピーしない。framework-owned primitive helperは同じ定義からvalue schemaと説明可能なmetadataを作る。既存domain enumは参照する。schema libraryのprivate ASTを直接探索してsyntaxを推測しない。

inputの値表現は`raw token -> field value -> domain input`を区別する。default適用後のhandler型と、生入力に許される欠落は同じではない。出力についてもdomain objectとwire JSONを混同しない。

### 7.3 既存domain decoderとの接続

既存Zod 3 schema、手書きdecoder、Effect Schema、repositoryから動的に解決される契約を、frameworkのためだけにZod 4へ書き直さない。既存の型付きdomain関数またはdecoderをhandler境界で呼び、その結果を元のerror mappingへ戻す。

この接続は「同じdomain schemaをframeworkにも登録する」ものではない。CLI Canonが所有するのは固定のCLI envelopeと構文までであり、Inariの選択済みIssue templateのような動的契約は外部authorityとして参照する。動的schemaを固定helpに完全展開できるとは表示しない。[I2]

### 7.4 公開schemaへの投射

JSON Schemaを出す対象は、wire representationとその用途を明示する。input用かoutput用かを選び、変換不能な型を`{}`へ縮退させない。Zodの変換には表現できない型があり、input/outputの選択も別である。[Z2]

公開契約を完全に投射すると宣言するsurfaceでは、未対応codec/refinementを構築時に拒否する。CLI内だけで使うopaqueなdomain decoderは参照identityと説明を公開し、JSON Schemaだけで同等のvalidationができるとは約束しない。`complete`と`structural-only`を区別し、後者を完全な契約としてcertifyしない。

## 8. Commandと実行経路

### 8.1 compileProductの順序

1. Authoring Modelのshapeを検証し、namespaceとIDの衝突を検査する。
2. command、field、Skill、path、handlerの参照を解決する。
3. routeとoption構文を検査し、backendで表現できるgrammarかを確認する。
4. 公開schema、usage、help、Skill projectionを構築し、欠落・予算超過を検査する。
5. 検証済みmodelを返す。途中失敗時には部分的なrouterを公開しない。

Compiler errorはcode、declarationの位置、参照IDを持つ。compilerはcommand handlerを実行しない。schemaのcustom callbackにもI/Oや環境依存を置かないことをauthoring contractとし、必要なdomain I/Oはhandler側へ残す。

### 8.2 Grammar

route、positionalの個数、repeatable、optional-value、alias、optionの許可位置、`--`以降のraw argv、option風の値の扱いを宣言する。unknown optionとsurplus positionalは既定で拒否し、許可する場合は明示された契約を要求する。

同じroute文字列を持つだけでは衝突とはしない。`skill`と`skill <scenario>`はoptional positionalを持つ一つの構文、または明確に分離できるvariantとして表現できる。曖昧性を取り除けない重なりを拒否する。現在のInari/Suzukuriに同じpathを持つindex/scenarioがあることを踏まえる。[I3][S1]

Nawabariのresource/modeのような順序依存grammarでは、optionを別々の配列へflattenしてから対応付けない。入力順序を保存したoccurrence列からgroupを検証する必要がある。この情報を選定backendの公開APIで保持できるかは実装admissionで証明する。証明前に該当commandを移行しない。backend内部APIのpatchや二重parserの常駐は採用しない。

### 8.3 実行とI/O

Commander instanceはinvocationごとに作り、global singletonを使わない。process終了と出力をadapterで捕捉する。Commanderの`exitOverride()`だけでは出力が止まるわけではないため、output hookも接続する。[C1]

adapterはvalidated inputを一つのhandlerへ渡し、結果をoutput policyへ渡す。framework-owned commandは`console`や`process.exit()`を直接呼ばない。既存domain runtimeの開始・終了・signal管理は製品のcomposition rootが所有し、help/Skillの取得でそのruntimeを起動しない。

エラーはparser failure、decode failure、domain failure、unexpected defectを区別する。domain error codeとexit codeを一律の`1`へ潰さない。各製品の既存mappingをadapterに結び付け、framework自身のconstruction errorとはnamespaceを分ける。

### 8.4 Invocation projection

実行表現のauthorityは`{ executable, argv: string[] }`とする。shell command文字列は表示用のprojectionであり、再解析して実行しない。OSごとのquotingを表示policyで扱う。

Skill/exampleはcommand IDとtyped bindingsを持つ。必要値が未確定なら`template`または`requires-input`として返し、`<path>`を含む表示を実行可能commandと偽らない。command path、usage、help pointerはSkill側へ手書きしない。Inariのprerequisite付きprojectionを一般化する。[I2]

## 9. Path Canon

Path Canonはfilesystemのpermission systemではなく、製品が所有するaddress規約である。

各pathはroot参照、relative segments、必要なparameter、file/directoryの種別を持つ。root取得は明示的な`PathContext`から行い、cwd、home、platform、必要なenv値を隠れたglobal readにしない。root参照のcycle、未定義parameter、childでの意図しないabsolute path上書き、root外へのlexical traversalを拒否する。

同じ物理pathが意図的aliasになる場合は同一targetへの参照で表現する。一律に「同じ文字列のpathは不正」としない。動的parameterやOSのcase/symlinkによる衝突は型検査だけでは確定しない。

Mottainaiのstate resolverにはenv override、XDGのabsolute判定、platformごとのdefaultがある。これを全製品へ同じ保存先として押し付けず、**明示したcontextと宣言から解決する枠組み**を抽出する。Windows対応も製品側の契約を維持する。[M3]

resolveはmkdir、realpathによる存在保証、chmod、cleanupを行わない。symlink、race、実際のownership、許可root、worktree安全性は既存filesystem/domain authorityが実行直前に検証する。`ResolvedPath`の型brandは書込許可を意味しない。

path literalを全repositoryから文字列検索して禁止するようなlintは採用しない。既存domainのpath計算、ユーザー入力path、fixtureの独立期待値まで禁止してしまうためである。管理対象pathの所有moduleを明示し、その範囲外での再定義と不正なimportを検査する。

## 10. SkillとOutput Canon

### 10.1 Skill

新規のCLI Canon製品では`skill` index、named scenario、text/JSON、command helpへの参照を標準surfaceとする。既存製品への導入で未存在のruntimeコマンドを黙って追加しない。Nawabariの生成playbookは文書projectionとして扱い、runtime `skill`追加は別の明示的な互換性判断にする。[Nw3]

scenarioはintent、手順、invariant、command参照、既存domain結果への参照を持つ。domainの`nextAction`を消費する指示は書けるが、次の状態や権限をSkillが再計算しない。commandを伴わない説明stepも許し、説明のために架空のcommandを要求しない。[I2][S4]

unknown command/Skill、delegate cycle、公開不可commandへの参照を構築時に検査する。文章の妥当性はreview対象であり、IDが存在するだけでplaybook全体が正しいとは扱わない。

### 10.2 出力

出力処理は`value -> encoding -> byte budget -> response outcome -> CliIO`の順とする。stream、bytes、exit codeを一つの結果として扱う。Mottainaiの明示的な`SkillCliResult`を採用し、serialization failureがsuccess exitになる構造を避ける。[M2]

framework-owned machine surfaceは完全なJSON文書を出す。capはUTF-8の実出力byte数で定義し、末尾改行も含める。JSON文字列の部分切断、Unicode途中切断、invariantや必須手順の黙った削除は禁止する。

既定のSkill budgetは4096 bytesを出発点とするが、既存製品の移行では末尾改行を含むかなども比較対象にする。小さすぎるbudgetは宣言時に拒否し、失敗文書自体が収まる最小容量を確保する。scenario超過は明示的なfailureにする。index増大へのpaginationは、必要になった時点でversion付きの契約として追加し、切り詰めで代用しない。

object keyの決定論的な順序と、意味を持つarray順序を区別する。JSON化不能な値や非有限数値を黙って変換しない。domainのwire codecがある場合はそれを使い、独自の二重serializerを置かない。

MCP stdio、interactive terminal、子processのstreaming outputはこの単一JSON responseとは別のtransport契約である。Mottainaiのno-args server起動やprotocol stdoutをframeworkのhelp/diagnosticで汚染しない。[M4]

## 11. FixtureとPackage Canon

### 11.1 共通化するのはscenario形式とharness

scenarioはstable ID、対象command参照、setup、input、独立したexpectation、必要な実行laneを持つ。clock/env/cwd/temp rootなどの非決定要素はfixture contextで固定する。source、built JS、installed tarballへ同じscenarioを適用できるようにする。

共有するinput/expected valueはJSON互換のdataを基本とし、setupに必要な製品固有処理はproduct-owned fixture moduleに置く。Git repository作成、署名authority、外部provider、Wabachiのquality corpusをCLI Canon自身のdomain fixtureにしない。Wabachiのpackage suiteにもgenericなbin検査と製品固有corpus検査が同居しており、これらを分離して抽出する。[W4]

### 11.2 SoTと独立oracleを両立する

**入力のSoT化と、正しさの期待値を実装から自動生成することは違う。** productionのhelp projectorを呼んでexpected helpを作り、同じprojectorの出力と比較しても、要求の取り違えを検出できない。

生成できるものはschemaの構造検査、参照整合性、同一scenarioの複数laneへの配線である。製品の重要なexit code、拒否条件、固定argvの意味、public schemaの必須fieldは契約から独立に期待値を書く。framework更新でexpected snapshotを自動承認しない。

既存Inariの手書きargv cases、Suzukuriのunknown参照・bounded JSON検査は残す価値がある。生成だけで成立するparity checkと、独立したauthority同士の整合性を検証するcheckを区別する。Nawabariのdomain vocabulary/public projectionのparityは、table共通化を理由に削除しない。[I3][S4][Nw2][Nw4]

### 11.3 packed artifactの証拠

frameworkのpackage gateは一度作ったtarballをisolated consumerへinstallし、exports、型import、root importの無副作用を確認する。CLI製品のgateはその製品のtarballについてbin、version、help、Skill、必要assetを確認する。framework自体にCLI binを新設する必要はない。

`npm pack --dry-run`のfile一覧、sourceのtest成功、repository内のdist実行だけを、配布物の動作証明に代用しない。同じtarballのidentityを検査と実行で保持する。製品固有のlive certificationは明示的laneに分け、offline package testに実機・本番認証を混ぜない。

標準のharnessは提供するが、各製品の`pnpm run verify`の順序や既存gateを全面置換しない。テスト分類・parallelization・CI必須statusは既存のauthorityに従う。[I4][Nw5][W5][S5][M5]

## 12. 適合性と受入条件

### 12.1 型とruntimeの最小証明集合

| 検証                  | 必須の証明                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Type tests            | ID typo、未登録Skill参照、handler過不足、command外option binding、result型不一致を拒否する。positive/negative両方を検証する。              |
| Construction tests    | JavaScript/unknown入力からの不正宣言、alias衝突、未解決参照、path cycle、曖昧grammarを拒否する。                                           |
| CLI boundary tests    | optionを先頭へ置く構文、equals、短縮alias、repeat、optional value、`--`、surplus positional、option風の値、順序付きgroupの契約を保持する。 |
| Projection tests      | root/leaf help、Skill、manifest、invocationの参照一致を確認し、独立した必須field・例も照合する。                                           |
| Output tests          | cap前後、Unicode、末尾改行、valid JSON、error/stream/exit整合性、secret非露出を確認する。                                                  |
| Path tests            | platform/env/cwdの明示入力、override順序、root外lexical path、parameter不足、解決の無副作用を確認する。                                    |
| Packed consumer tests | 配布tarballからの型解決、import無副作用、必要exports/assets、製品binの動作を確認する。                                                     |

これは「念のため」のテスト増殖ではなく、C01–C12と移行する公開契約を証明する集合である。巨大なcross-product全組合せではなく、共有primitiveごとの代表ケースと、consumerごとの実際の契約を選ぶ。

### 12.2 最初のbackend admission corpus

Inariから`--repository`/`-R`をcommandより前へ置くケース、`--field`のrepeatとoption applicability、`skill`のarityを採る。Wabachiからprogressive helpとoptional positionalを採る。Suzukuriからlibrary/CLI分離とbounded Skillを採る。Mottainaiからmissing/option-looking valueとno-args server境界を採る。Nawabariから`--`以降のargv保持とresource/modeの順序制約を採る。[I3][W1][S3][S5][M1][M4][Nw1]

移行するprimitiveがこのcorpusを満たせない場合、backendまたはgrammar loweringを修正する。現行契約を変更してcorpusを合わせない。現時点でこのadmissionを通過したとの主張はしない。

### 12.3 「適合済み」の条件

適合性は明示されたcommand/path/surfaceの範囲に対して記録する。discoveryだけがframework由来の段階を、executionまで適合した製品として表示しない。

一つの移行単位は、宣言・handler・parser・help・Skill参照・fixture・配布検証まで接続され、その範囲に残る二重authorityが削除されて初めて完了する。例外はscopeと理由を明示し、暗黙fallbackを含めない。

## 13. 導入順序と変更管理

### 13.1 初期実装の依存関係

```text
M0: authoring/compiler + schema/grammar admission
                    |
M1: Wabachiの小さいread-only subtreeで実行まで接続
                    |
M2: Skill/output + source/built/packed harnessの共通化
                    |
M3: Suzukuri、Nawabari、Inari、Mottainaiへ契約単位で展開
```

M0の共通型とcompilerが確定する前に5製品のadapterを並列実装しない。型・error・input contractのproducerを先に成立させる。M3のconsumer作業は共通packageの同じ検証済みversionを基準に分ける。

### 13.2 consumer別の移行焦点

Wabachiを最初の実consumerとし、小さいread-only command subtreeで宣言から実行までの縦断を証明する。versionとSkill文書を同時に全面刷新する必要はない。framework導入そのものの差分を識別可能にする。

Suzukuriはstringへ広がったIDと手書きsyntaxを閉じ、library entryの無副作用を維持する。bounded semantic engineは動かさない。

Nawabariは既に強いliteral型をdonorとして使うが、順序付きgroup、session targeting、protected executionの互換性を先に証明する。claim enforcementやfilesystem実装は触らない。

Inariはcommand-owned applicabilityとSkill/domain参照を維持し、command-specific bindingへ狭める。動的なrepository governanceを固定schemaへ変換しない。認証・relay・providerの変更は含めない。

Mottainaiは単一command familyずつ手書きUSAGE/parserを置き換える。no-args server、MCP stdio、task launchの既存分岐は契約として維持する。巨大なCLI全体の一括rewriteを最初のconsumerにしない。

### 13.3 二重authorityを残さない移行

移行前のraw argv/出力/exit code/必要assetをcharacterization corpusとして固定する。移行後は同じcorpusを再利用し、framework由来の新しいexpectedで上書きしない。

部分移行ではcomposition rootが新旧の所有subtreeを明示的に分ける。同じrouteを両方へ登録しない。未移行範囲は適合済みと表示せず、移行済み範囲の古いparser/usage/projectionは削除する。互換性差分の承認が必要な場合は、共通化とは区別した変更として扱う。

### 13.4 versionとrollback

framework package version、Canon model format version、製品のpublic contract version、製品package versionを区別する。内部向けでもconsumerから参照するreleaseは固定し、複数repoへ無条件に最新版を流さない。

backendの更新は「内部依存更新」だけで互換性を免除しない。構文、error、help、output byte、型宣言への影響を検証する。rollbackは各consumerのframework versionとadapter変更を戻す単位で可能にし、このframework導入にdomainの永続state migrationを抱き合わせない。

## 14. この設計で作らないもの

汎用plugin marketplace、独自言語のparser generator、任意schema libraryの統一AST、EffectのDI/runtimeの再実装、全製品共通のdomain error taxonomy、全domainを載せるXState machine、Git/filesystemの認可engine、MCP/HTTP server、CLIから自動で操作権限を推論する仕組みは作らない。

ESLint等の規則は補助とし、主要な制約はAPIとcompilerの構造で成立させる。自由なhandler内で全ての`path.join`や`console`を完全に禁止できるとは言わない。管理対象moduleの境界を狭く定義し、テストとreviewで補う。

「共通化」は同じ意味の情報を再実装しないために行う。表面的に似たJSONや同名のoptionを、異なるdomain契約まで一つに統合するためには使わない。

## 15. 設計の承認対象と実装時の証拠

本PRで承認する対象は、SoT-firstの所有境界、三段階model、推奨基盤、C01–C12、移行の互換性条件、domain/CI責務を残す方針である。API例の関数名や具体的patch versionは実装済みcontractではない。

初回実装PRには、backend admission結果、型のpositive/negative検証、packed consumer検証、依存lockと比較計測を付ける。ライブラリのAPI差で本書の条件を満たせない場合は、その具体的証拠をもって設計を改訂する。既存製品の契約を黙って弱めて辻褄を合わせない。

この設計書の提出時点では、consumerへの変更、runtime testの成功、CI green、依存の完全な安全性、全productの適合を主張しない。

## 16. 参照資料

コード参照は第2章のcommitへ固定した。行番号を付けたリンクは本調査で確認した範囲を示す。package参照はそのcommitのdependency/entry/script宣言であり、インストール済み依存木の実測ではない。外部文書は2026-09-22の調査で参照したAPI仕様であり、採用versionのlockに代わるものではない。

### 製品の一次資料

[I1]: https://github.com/yohn-jp/gh-inari/blob/e82dc3cf23dee09d491f145c2782cdede59523eb/src/command-contract.ts#L1-L280
[I2]: https://github.com/yohn-jp/gh-inari/blob/e82dc3cf23dee09d491f145c2782cdede59523eb/src/skill.ts#L1-L145
[I3]: https://github.com/yohn-jp/gh-inari/blob/e82dc3cf23dee09d491f145c2782cdede59523eb/src/command-contract.test.ts#L1-L150
[I4]: https://github.com/yohn-jp/gh-inari/blob/e82dc3cf23dee09d491f145c2782cdede59523eb/package.json
[Nw1]: https://github.com/yohn-jp/nawabari/blob/6b63542380fac428d1970f0303b93f700e9aa20c/src/cli-command-registry.ts#L1-L130
[Nw2]: https://github.com/yohn-jp/nawabari/blob/6b63542380fac428d1970f0303b93f700e9aa20c/src/cli.ts#L60-L155
[Nw3]: https://github.com/yohn-jp/nawabari/blob/6b63542380fac428d1970f0303b93f700e9aa20c/src/cli-skill-projection.ts
[Nw4]: https://github.com/yohn-jp/nawabari/blob/6b63542380fac428d1970f0303b93f700e9aa20c/src/product-state-manifest.ts#L1-L260
[Nw5]: https://github.com/yohn-jp/nawabari/blob/6b63542380fac428d1970f0303b93f700e9aa20c/package.json
[W1]: https://github.com/yohn-jp/wabachi/blob/d30d322247431814ccc00c9d353cb84735258d9b/src/command-contract.ts#L1-L190
[W2]: https://github.com/yohn-jp/wabachi/blob/d30d322247431814ccc00c9d353cb84735258d9b/src/cli.ts
[W3]: https://github.com/yohn-jp/wabachi/blob/d30d322247431814ccc00c9d353cb84735258d9b/src/skill.ts
[W4]: https://github.com/yohn-jp/wabachi/blob/d30d322247431814ccc00c9d353cb84735258d9b/scripts/run-package-suite.mjs
[W5]: https://github.com/yohn-jp/wabachi/blob/d30d322247431814ccc00c9d353cb84735258d9b/package.json
[S1]: https://github.com/yohn-jp/suzukuri/blob/94eaded74b26aa4dfb0c130687e0a99940ef8fb5/src/command-contract.ts
[S2]: https://github.com/yohn-jp/suzukuri/blob/94eaded74b26aa4dfb0c130687e0a99940ef8fb5/src/cli.ts#L1-L175
[S3]: https://github.com/yohn-jp/suzukuri/blob/94eaded74b26aa4dfb0c130687e0a99940ef8fb5/src/skill.ts#L285-L510
[S4]: https://github.com/yohn-jp/suzukuri/blob/94eaded74b26aa4dfb0c130687e0a99940ef8fb5/src/skill.test.ts
[S5]: https://github.com/yohn-jp/suzukuri/blob/94eaded74b26aa4dfb0c130687e0a99940ef8fb5/package.json
[M1]: https://github.com/yohn-jp/mottainai/blob/63affbd23f84c6cd23bf82d6e82e376b3a545d55/src/cli.ts#L1-L210
[M2]: https://github.com/yohn-jp/mottainai/blob/63affbd23f84c6cd23bf82d6e82e376b3a545d55/src/skill.ts
[M3]: https://github.com/yohn-jp/mottainai/blob/63affbd23f84c6cd23bf82d6e82e376b3a545d55/src/state/paths.ts
[M4]: https://github.com/yohn-jp/mottainai/blob/63affbd23f84c6cd23bf82d6e82e376b3a545d55/src/index.ts
[M5]: https://github.com/yohn-jp/mottainai/blob/63affbd23f84c6cd23bf82d6e82e376b3a545d55/package.json
[G1]: https://github.com/yohn-jp/.github/blob/main/docs/github-metadata-inheritance.md

### 採用候補の公式仕様

[E1]: https://www.effect.website/docs/v3/schema/introduction
[E2]: https://effect-ts.github.io/effect/cli/CommandDescriptor.ts.html
[E3]: https://effect-ts.github.io/effect/cli/CliConfig.ts.html
[Z1]: https://zod.dev/metadata
[Z2]: https://zod.dev/json-schema
[C1]: https://github.com/tj/commander.js
[N1]: https://docs.npmjs.com/cli/v11/using-npm/scope/

[Effect Schema][E1]、[Effect CLI][E2]、[Effect CLI configuration][E3]、[Zod registry][Z1]、[Zod JSON Schema][Z2]、[Commander][C1]、[npm scope][N1]。
