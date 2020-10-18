type status =
  | Pending
  | InProgress
  | Done
  [@@deriving show { with_path = false }]

type t =
  { id: int;
    content: string;
  } [@@deriving show { with_path = false }, to_yojson]

let make ~id ~content = { id; content }
