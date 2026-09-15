import { useParams } from "react-router-dom";

const users = {
  8123: { name: "Jamie Lee", role: "Product owner", email: "jamie@northwind.example" },
  8124: { name: "Sam Rivera", role: "Support lead", email: "sam@northwind.example" },
};

// Mounted at /users/:id, so the probe can resolve a route pattern with a real param instead of
// just a bare pathname.
export function UserPage() {
  const { id } = useParams();
  const user = users[id] ?? { name: `User ${id}`, role: "Unknown", email: "" };

  return (
    <>
      <header className="topbar">
        <div>
          <h1 className="title">{user.name}</h1>
          <p className="subtitle">{user.role}</p>
        </div>
      </header>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Profile</h2>
        </div>
        <table className="table">
          <tbody>
            <tr>
              <td>Name</td>
              <td>{user.name}</td>
            </tr>
            <tr>
              <td>Role</td>
              <td>{user.role}</td>
            </tr>
            <tr>
              <td>Email</td>
              <td>{user.email || "—"}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
