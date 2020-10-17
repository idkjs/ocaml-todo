type t =
  | DbError of string
  [@@deriving show { with_path = false }]

let unwrap m =
  match%lwt m with
  | Ok x ->
     Lwt.return (Ok x)
  | Error e ->
     Lwt.return (Error (DbError (Caqti_error.show e)))
