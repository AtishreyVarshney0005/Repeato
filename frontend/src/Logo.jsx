export default function Logo({ size = 40 }) {
    return <span className="repeato-mark" style={{ width: size, height: size }} role="img" aria-label="Repeato">
      <img src="/repeato-logo.jpeg" alt="" aria-hidden="true"/>
    </span>;
}
