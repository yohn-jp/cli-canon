# cli-canon

`@yohn-jp/cli-canon` — yohn-jpのTypeScript CLI製品向け内部framework。

各事実の所有者を一つに固定し、型付きの宣言を検証済みProduct Modelへ変換して、実行・help・Skill・機械可読契約へ投射する。

## 設計

[アーキテクチャ設計書](docs/architecture/cli-canon.md)

Inari、Nawabari、Wabachi、Suzukuri、Mottainaiの固定commitを分析し、共通化するCanon、製品側に残す責務、Effectを含む基盤比較、型・実行時の保証範囲、fixtureと配布物検証、段階的な移行条件を整理している。

設計は **Proposed**。runtime実装、consumer移行、npm publishはこの設計提出の範囲に含めない。
