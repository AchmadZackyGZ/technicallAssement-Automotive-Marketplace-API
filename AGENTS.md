# AGENTS.md - Automotive Marketplace API Assessment

## PT Daya Rekadigital Indonesia - Backend Developer Technical Assessment

---

## 🎯 PROJECT OVERVIEW

Build a production-grade RESTful API for an automotive marketplace platform where sellers list vehicles and buyers browse, filter, and search listings.

**Duration:** 3 Days (Take-Home Assessment)  
**Deadline:** Friday, 25 September 2026, 12:00 WIB  
**Focus Areas:** Schema design, category/filter architecture, search performance, code quality

---

## ️ TECH STACK (STRICT - DO NOT DEVIATE)

| Component        | Choice                  | Notes                                      |
| ---------------- | ----------------------- | ------------------------------------------ |
| Runtime          | Node.js 20+ LTS         |                                            |
| Framework        | Express.js              | Simple, fast, no over-engineering          |
| Database         | PostgreSQL 15+          | Relational only                            |
| ORM              | FORBIDDEN               | Use raw SQL with `pg` (node-postgres) only |
| Validation       | Zod                     | For request validation                     |
| Auth             | JWT (HS256)             | For protected endpoints                    |
| Caching          | Redis                   | **BONUS POINTS** - For search results      |
| Containerization | Docker + docker-compose | **BONUS POINTS**                           |
| Deployment       | Railway                 | Must be publicly accessible                |
| Schema Diagram   | dbdiagram.io            | ERD required in deliverables               |

---

## ARCHITECTURE DECISIONS

### Clean Architecture / Modular Monolith
