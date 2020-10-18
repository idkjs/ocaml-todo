open Todo_model

val create : Todo.t -> (unit, string) Lwt_result.t

val find : int -> (Todo.t, string) Lwt_result.t

val all : unit -> (Todo.t list, string) Lwt_result.t

val destroy : int -> (unit, string) Lwt_result.t
