(lang dune 2.7)

(generate_opam_files true)

(name ocaml_todo)

(version 0.1.0)

(authors "vyorkin")

(license MIT)

; TODO

(source
 (uri "git+https://github.com/vyorkin/ocaml-todo.git.git"))

; TODO

(maintainers "vasiliy.yorkin@gmail.com")

; TODO

(homepage "https://github.com/vyorkin/ocaml-todo.git")

; TODO

(bug_reports "https://github.com/vyorkin/ocaml-todo.git/issues")

; TODO

(documentation "https://github.com/vyorkin/ocaml-todo/README.md")

; TODO

(package
 (name ocaml_todo)
 (synopsis "A minimal example of a lightweight webapp in OCaml") ; TODO
 (description "A minimal webapp using Opium, Catqi, and tyXML") ; TODO
 (depends
  ;; General system dependencies
  ;; General system dependencies
  (dune
   (>= 2))
  (ocaml
   (= 4.11.1))
  ;; Standard library replacement
  (core
   (>= v0.12.2))
  (core_kernel
   (and
    (>= v0.12.0)))
  ;; Web toolkit
  (opium
   (>= 0.17.1))
  ( opium_kernel
   (>= 0.17.1))
  ;; Database interface
  (caqti
   (>= 1.2.3))
  (caqti-lwt
   (>= 1.2.0))
  (caqti-driver-postgresql
   (>= 1.2.4))
  (ppx_rapper
   (>= 2.0.0))
  (bignum
   (and
    (>= v0.14)
    (< v0.15)))
  ; (ppx_rapper_lwt
  ;  (= 3.0.0))
  ; (ppx_rapper
  ;  (= 3.0.0))
  ;; Web toolkit
  (reason
   (and
    (>= 3.6.0)
    (< 4.0.0)))
  (uri
   (and
    (>= 3.1.0)
    (< 4.0.0)))
  websocket-lwt-unix
  dotenv
  (ppx_sexp_conv
   (>= v0.14.1))
  (ppx_deriving
   (>= 5.1))
  ; (caqti
  ;  (>= 1.2.3))
  ; (caqti-lwt
  ;  (>= 1.2.0))
  ; (caqti-driver-postgresql
  ;  (>= 1.2.4))
  (lwt_ppx
   (>= 2.0.1))
  (httpaf
   (>= 0.6.0))
  (prometheus
   (>= 0.7))
  ;; JSON
  (ppx_deriving_yojson
   (= 3.6.1))
  (ppx_yojson
   (= 1.1.0))
  (yojson
   (= 1.7.0))
  (reason
   (and
    (>= 3.6.0)
    (< 4.0.0)))
  ;; HTML generation
  (tyxml
   (>= 4.3.0))
  ;; Logging
  (logs
   (>= 0.7.0))
  (fmt
   (>= 0.8.0))
  ; "fmt" {>= "0.8.0"}
  ; "logs" {>= "0.5.0"}
  ;; Dev dependencies

  (ocaml-lsp-server :dev)))
