import type { CommandCatalog, CommandId, GroupCatalog, GroupId } from "./model.js";

/** Explicit structural node kinds of a canonical command tree. */
export type CommandTreeNodeKind = "root" | "group" | "command";

/** An executable leaf referencing exactly one declared command. */
export interface CommandTreeCommandNode<
  Commands extends CommandCatalog = CommandCatalog,
  Id extends CommandId<Commands> = CommandId<Commands>,
> {
  readonly kind: "command";
  readonly id: Id;
  readonly route: Commands[Id]["route"];
  readonly definition: Commands[Id];
}

/** A non-executable route group referencing exactly one declared group. */
export interface CommandTreeGroupNode<
  Groups extends GroupCatalog = GroupCatalog,
  Commands extends CommandCatalog = CommandCatalog,
  Id extends GroupId<Groups> = GroupId<Groups>,
> {
  readonly kind: "group";
  readonly id: Id;
  readonly route: Groups[Id]["route"];
  readonly definition: Groups[Id];
  readonly children: readonly CommandTreeChildNode<Groups, Commands>[];
}

export type CommandTreeChildNode<
  Groups extends GroupCatalog = GroupCatalog,
  Commands extends CommandCatalog = CommandCatalog,
> =
  | { readonly [Id in GroupId<Groups>]: CommandTreeGroupNode<Groups, Commands, Id> }[GroupId<Groups>]
  | { readonly [Id in CommandId<Commands>]: CommandTreeCommandNode<Commands, Id> }[CommandId<Commands>];

/** The product root. It has no route of its own and is not executable. */
export interface CommandTreeRootNode<
  Groups extends GroupCatalog = GroupCatalog,
  Commands extends CommandCatalog = CommandCatalog,
> {
  readonly kind: "root";
  readonly children: readonly CommandTreeChildNode<Groups, Commands>[];
}

export type CommandTreeNode<
  Groups extends GroupCatalog = GroupCatalog,
  Commands extends CommandCatalog = CommandCatalog,
> = CommandTreeRootNode<Groups, Commands> | CommandTreeChildNode<Groups, Commands>;
