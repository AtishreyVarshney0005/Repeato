import repeatoLogo from '../repeato-logo.jpeg';

export default function Logo({ size = 40 }) {
    return <span className="repeato-mark" style={{ width: size, height: size }} role="img" aria-label="Repeato">
      <img src={repeatoLogo} alt="" aria-hidden="true"/>
    </span>;
}
